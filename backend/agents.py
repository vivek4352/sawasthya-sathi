import time
import re
import os
import json
from typing import List, Dict, Optional, Any
from pydantic import BaseModel
from google import genai

# Configure Gemini Multi-Key System
keys_raw = os.getenv("GEMINI_API_KEYS") or os.getenv("GEMINI_API_KEY")
API_KEYS = [k.strip() for k in keys_raw.split(",")] if keys_raw else []

class GeminiKeyManager:
    """Manages multiple Gemini API keys and handles rotations and cooldowns."""
    def __init__(self, keys: List[str]):
        self.keys = keys
        self.current_idx = 0
        self.cooling_keys = {} # key -> timestamp when it can be used again
        
    def mark_key_limited(self, key: str, duration: int = 60):
        """Marks a key as rate-limited for a set duration."""
        self.cooling_keys[key] = time.time() + duration
        print(f"Key {key[:10]}... put on cooldown for {duration} seconds.")

    def mark_key_dead(self, key: str):
        """Marks a key as permanently dead (until restart)."""
        self.cooling_keys[key] = time.time() + 86400 # 24 hours
        print(f"Key {key[:10]}... marked as DEAD (Expired/Invalid).")

    def get_client(self) -> Optional[tuple[genai.Client, str]]:
        if not self.keys: return None
        
        start_idx = self.current_idx
        while True:
            key = self.keys[self.current_idx]
            # Check if key is cooling down
            cooldown_until = self.cooling_keys.get(key, 0)
            if time.time() > cooldown_until:
                # Key is healthy or cooldown expired
                if key in self.cooling_keys:
                    del self.cooling_keys[key] # Cleanup
                
                self.current_idx = (self.current_idx + 1) % len(self.keys)
                return genai.Client(api_key=key), key
            
            # Key is cooling, try next one
            self.current_idx = (self.current_idx + 1) % len(self.keys)
            if self.current_idx == start_idx:
                # All keys are cooling down! Return anyway to attempt retry
                key = self.keys[self.current_idx]
                self.current_idx = (self.current_idx + 1) % len(self.keys)
                return genai.Client(api_key=key), key

key_manager = GeminiKeyManager(API_KEYS)

# --- Models ---

class ExtractedSymptoms(BaseModel):
    symptoms: List[str]
    duration: Optional[str] = "Not specified"
    severity: Optional[str] = "Moderate"

class ChatResponse(BaseModel):
    message: str
    is_ready_for_triage: bool = False
    summary: Optional[str] = None

class TriageResult(BaseModel):
    status: str  # CRITICAL, MODERATE, MILD
    reasoning: str
    red_flags: List[str]

class CareAdvice(BaseModel):
    home_care_tips: List[str]
    simple_explanation: str
    specific_remedies: List[str]  # OTC meds for modern, home remedies for ayurvedic

class ActionOutput(BaseModel):
    immediate_action: str
    modern: CareAdvice
    ayurvedic: CareAdvice

class UnifiedTriageResult(BaseModel):
    extraction: ExtractedSymptoms
    triage: TriageResult
    actions: ActionOutput

# --- Agents ---

class BaseAgent:
    def __init__(self, name: str, system_instructions: str):
        self.name = name
        self.system_instructions = system_instructions

class ClarificationAgent(BaseAgent):
    """
    Clarifies clinical symptoms through natural conversation, one question at a time.
    """
    def __init__(self):
        super().__init__(
            "Clarification Agent",
            """You are an intelligent and empathetic Medical Symptom Clarifier. Your goal is to deeply understand the user's current health problem while keeping the conversation easy and low-stress.
    
    STRICT USER EXPERIENCE PROTOCOL:
    1. FIRST RESPONSE: Acknowledge the user's Name, Age, and Clinical History (if provided).
    2. ONE QUESTION RULE: You MUST ask exactly ONE follow-up question per turn. Never list multiple questions. This makes it easier for the user to respond.
    3. CONVERSATIONAL GOAL: Collect info on: Core symptoms, Location, Duration, and Severity.
    4. TRIAGE READINESS: When you have a clear picture, provide a summary immediately.
    5. SIGNALING: To end the conversation, your response MUST contain "SUMMARY: [A concise clinical summary]".
    
    Tone: Warm, professional, supports Hinglish. Be a friend, not a form."""
        )

    def process_chat(self, history: List[Dict[str, str]], patient_info: Dict[str, Any]) -> ChatResponse:
        name = patient_info.get('name', 'User')
        age = patient_info.get('age', 'Unknown')
        hx = patient_info.get('history', 'No prior history')
        
        patient_context = f"PATIENT IDENTITY: Name={name}, Age={age}, Known History={hx}."
        conversation = "\n".join([f"{m['role']}: {m['content']}" for m in history])
        
        full_prompt = f"""
        {patient_context}
        
        Recent Conversation:
        {conversation}
        
        INSTRUCTION: Continue the conversation naturally to understand the health problem. 
        If you have enough information for a triage assessment (Symptoms, Location, Duration, Severity), 
        summarize the findings and include the "SUMMARY:" tag.
        """
        
        # Try up to N keys if we have them
        max_retries = min(len(API_KEYS) if API_KEYS else 1, 2)
        for attempt in range(max_retries):
            key = None
            try:
                res = key_manager.get_client()
                if not res:
                    raise Exception("No API keys configured.")
                client, key = res

                response = client.models.generate_content(
                    model='gemini-2.0-flash',
                    contents=full_prompt,
                    config={
                        'system_instruction': self.system_instructions
                    }
                )
                text = response.text.strip()
                
                if "SUMMARY:" in text:
                    summary_part = text.split("SUMMARY:")[1].strip()
                    return ChatResponse(
                        message="I've gathered the necessary details. I've prepared a summary for the triage phase. Should we proceed?",
                        is_ready_for_triage=True,
                        summary=summary_part
                    )
                else:
                    return ChatResponse(message=text, is_ready_for_triage=False)
            except Exception as e:
                error_str = str(e)
                if "429" in error_str:
                    if key:
                        key_manager.mark_key_limited(key)
                    if attempt < max_retries - 1:
                        print(f"Key rotation attempt {attempt+1}/{max_retries}...")
                        continue
                
                if "400" in error_str or "expired" in error_str.lower() or "invalid" in error_str.lower():
                    if key:
                        key_manager.mark_key_dead(key)
                    if attempt < max_retries - 1:
                        print(f"Expired/Invalid key rotation attempt {attempt+1}/{max_retries}...")
                        continue

                print(f"Gemini Chat Error: {e}")
                raise e

class UnifiedTriageAgent(BaseAgent):
    """
    All-in-one Clinical Intelligence Agent.
    Consolidates Extraction, Triage, and Recommendation into a single high-efficiency call.
    """
    def __init__(self):
        super().__init__(
            "Unified Triage Agent",
            """You are an expert Clinical Intelligence System. Analyze patient input and provide a precise medical assessment.
            
            OUTPUT: Valid JSON ONLY.
            JSON Structure:
            {
              "extraction": { "symptoms": ["..."], "duration": "...", "severity": "MILD/MODERATE/SEVERE" },
              "triage": { "status": "CRITICAL/MODERATE/MILD", "reasoning": "...", "red_flags": ["..."] },
              "actions": {
                "immediate_action": "...",
                "modern": { "home_care_tips": ["..."], "simple_explanation": "...", "specific_remedies": ["OTC help if not CRITICAL"] },
                "ayurvedic": { "home_care_tips": ["..."], "simple_explanation": "...", "specific_remedies": ["Home remedies if not CRITICAL"] }
              }
            }
            
            SAFETY: If CRITICAL, specific_remedies MUST be [].
            Focus on speed and clinical accuracy."""
        )

    def process(self, patient_info: Dict[str, Any], chat_history: List[Dict]) -> UnifiedTriageResult:
        name = patient_info.get('name', 'Patient')
        age = patient_info.get('age', 'Unknown')
        history = patient_info.get('history', 'None')
        symptoms_raw = patient_info.get('symptoms_raw', '')
        conversation_text = "\n".join([f"{m['role'].upper()}: {m['content']}" for m in chat_history]) if chat_history else "No chat."

        prompt = f"""
        Patient: {name}, Age: {age}, History: {history}
        Reported: {symptoms_raw}
        Conversation Context:
        {conversation_text}
        
        Perform full extraction, triage, and recommendation generation.
        """
        
        max_retries = min(len(API_KEYS) if API_KEYS else 1, 2)
        for attempt in range(max_retries):
            key = None
            try:
                res = key_manager.get_client()
                if not res:
                    raise Exception("No API keys configured.")
                client, key = res
                
                response = client.models.generate_content(
                    model='gemini-1.5-flash',
                    contents=prompt,
                    config={
                        'system_instruction': self.system_instructions,
                        'response_mime_type': 'application/json'
                    }
                )
                text = response.text.strip()
                data = json.loads(text)
                return UnifiedTriageResult(**data)
            except Exception as e:
                error_str = str(e)
                if "429" in error_str:
                    if key:
                        key_manager.mark_key_limited(key)
                    if attempt < max_retries - 1:
                        print(f"Triage Key rotation attempt {attempt+1}/{max_retries}...")
                        continue
                
                if "400" in error_str or "expired" in error_str.lower() or "invalid" in error_str.lower():
                    if key:
                        key_manager.mark_key_dead(key)
                    if attempt < max_retries - 1:
                        print(f"Expired/Invalid Triage Key rotation attempt {attempt+1}/{max_retries}...")
                        continue
                    
                print(f"Unified Triage Error (Attempt {attempt}): {e}")
                raise e

    def get_local_fallback(self, symptoms: str, name: str) -> UnifiedTriageResult:
        """Rule-based emergency fallback when AI is unavailable."""
        symptoms_lower = symptoms.lower()
        
        # Simple rule-based triage
        status = "MILD"
        reasoning = "Based on local safety protocols, your symptoms appear manageable, but require monitoring."
        red_flags = ["High fever > 103F", "Persistent vomiting", "Difficulty breathing"]
        immediate_action = "Monitor your symptoms closely and rest."
        modern_remedies = []
        ayurvedic_remedies = []
        
        if any(w in symptoms_lower for w in ["chest", "breath", "unconscious", "stroke", "bleeding", "severe"]):
            status = "CRITICAL"
            reasoning = "Emergency symptoms detected. Local protocol mandates immediate medical evaluation."
            immediate_action = "VISIT EMERGENCY ROOM IMMEDIATELY OR CALL AN AMBULANCE."
            red_flags.append("Loss of consciousness")
        elif any(w in symptoms_lower for w in ["fever", "pain", "stomach", "dard"]):
            status = "MODERATE"
            reasoning = "Moderate discomfort detected. Please consult a doctor if symptoms persist."
            immediate_action = "Schedule a consultation with a General Physician."
            if "fever" in symptoms_lower:
                modern_remedies = ["Paracetamol (650mg)", "Electrolyte fluids"]
                ayurvedic_remedies = ["Giloy Juice", "Tulsi tea", "Cool cloth compress"]
            elif "stomach" in symptoms_lower or "dard" in symptoms_lower:
                modern_remedies = ["Antacids", "Dicyclomine (if prescribed)"]
                ayurvedic_remedies = ["Ajwain with warm water", "Ginger tea", "Hing (Asafoetida) paste on navel"]
        else:
            # MILD defaults
            modern_remedies = ["Rest", "Hydration", "Multi-vitamins"]
            ayurvedic_remedies = ["Warm water with lemon", "Triphala Churna", "Honey and Ginger"]

        return UnifiedTriageResult(
            extraction=ExtractedSymptoms(symptoms=[symptoms], duration="Recent", severity=status),
            triage=TriageResult(status=status, reasoning=reasoning, red_flags=red_flags),
            actions=ActionOutput(
                immediate_action=immediate_action,
                modern=CareAdvice(
                    home_care_tips=["Stay hydrated", "Monitor temperature", "Take prescribed OTC meds for pain"],
                    simple_explanation=f"Hello {name}, your symptoms suggest a {status.lower()} condition. Please follow the immediate action for safety.",
                    specific_remedies=modern_remedies if status != "CRITICAL" else []
                ),
                ayurvedic=CareAdvice(
                    home_care_tips=["Drink warm ginger water", "Rest in a quiet room", "Avoid heavy foods"],
                    simple_explanation=f"Namaste {name}, from an Ayurvedic perspective, your body needs rest and purification. Follow these simple tips.",
                    specific_remedies=ayurvedic_remedies if status != "CRITICAL" else []
                )
            )
        )

class SwasthyaSathiCoordinator:
    def __init__(self):
        self.chatter = ClarificationAgent()
        self.unified_agent = UnifiedTriageAgent()
        
    def chat(self, history: List[Dict[str, str]], patient_info: Dict[str, Any]) -> ChatResponse:
        return self.chatter.process_chat(history, patient_info)

    def run_workflow(self, name: str, age: str, history: str, symptoms_text: str, chat_history: List[Dict] = None) -> Dict[str, Any]:
        patient_info = {
            "name": name,
            "age": age,
            "history": history,
            "symptoms_raw": symptoms_text
        }
        
        try:
            # SINGLE API CALL instead of three!
            result = self.unified_agent.process(patient_info, chat_history)
            return {
                "success": True,
                "patient_context": {"name": name, "age": age, "history": history},
                "extraction": result.extraction.dict(),
                "triage": result.triage.dict(),
                "actions": result.actions.dict()
            }
        except Exception as e:
            print(f"Workflow API Error: {e}. Attempting local fallback.")
            # EMERGENCY FALLBACK
            try:
                result = self.unified_agent.get_local_fallback(symptoms_text, name)
                return {
                    "success": True,
                    "is_fallback": True,
                    "patient_context": {"name": name, "age": age, "history": history},
                    "extraction": result.extraction.dict(),
                    "triage": result.triage.dict(),
                    "actions": result.actions.dict()
                }
            except Exception as fe:
                print(f"Critical Fallback Failure: {fe}")
                raise e # Raise original API error if even fallback fails
