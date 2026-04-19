import uvicorn
from dotenv import load_dotenv

# Load environmental variables at the very beginning
load_dotenv()

from typing import List, Dict
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from agents import SwasthyaSathiCoordinator

app = FastAPI(title="Swasthya Sathi AI Backend")
orchestrator = SwasthyaSathiCoordinator()

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class TriageRequest(BaseModel):
    name: str
    age: str
    history: str
    symptoms: str
    chat_history: List[Dict[str, str]] = []

class ChatRequest(BaseModel):
    name: str
    age: str
    history: str
    chat_history: List[Dict[str, str]]

@app.post("/chat")
async def chat_with_assistant(request: ChatRequest):
    try:
        patient_info = {
            "name": request.name,
            "age": request.age,
            "history": request.history
        }
        result = orchestrator.chat(request.chat_history, patient_info)
        return result
    except Exception as e:
        if "429" in str(e):
            raise HTTPException(status_code=429, detail="Too many requests to Gemini")
        print(f"Chat Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/triage")
async def get_triage(request: TriageRequest):
    try:
        if not request.name.strip():
            raise HTTPException(status_code=400, detail="Patient name is required")
        
        try:
            age_val = int(request.age)
            if age_val <= 0:
                raise ValueError("Age must be positive")
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="A valid positive age is required")

        if not request.symptoms.strip():
            raise HTTPException(status_code=400, detail="Symptoms description is required")
        
        result = orchestrator.run_workflow(
            name=request.name,
            age=request.age,
            history=request.history,
            symptoms_text=request.symptoms,
            chat_history=request.chat_history
        )
        return result
    except Exception as e:
        if "429" in str(e):
            raise HTTPException(status_code=429, detail="Too many requests to Gemini")
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

import os

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
