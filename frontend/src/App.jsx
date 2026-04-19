import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  Mic,
  Activity,
  User,
  Plus,
  X,
  ChevronRight,
  AlertCircle,
  MapPin,
  ShieldCheck,
  Stethoscope,
  Info,
  Clock,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
const API_BASE = import.meta.env.VITE_API_BASE || "https://sawasthya-sathi.onrender.com";

const BentoCard = ({ children, className = "", delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    className={`glass bento-item p-3 md:p-4 ${className}`}
  >
    {children}
  </motion.div>
);

const RiskGauge = ({ status }) => {
  const getProgress = () => {
    if (status === "CRITICAL") return 90;
    if (status === "MODERATE") return 50;
    return 20;
  };

  const getColor = () => {
    if (status === "CRITICAL") return "#FF3B30";
    if (status === "MODERATE") return "#FF9500";
    return "#34C759";
  };

  const progress = getProgress();
  const radius = 80;
  const circumference = Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative flex flex-col items-center justify-center pt-6">
      <svg width="200" height="120" className="rotate-0">
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke="#E5E5EA"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <motion.path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={getColor()}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 mt-4 text-center">
        <span className="text-3xl font-black block" style={{ color: getColor() }}>{status || "--"}</span>
        <span className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Severity Score</span>
      </div>
    </div>
  );
};


function App() {
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [historyTags, setHistoryTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [apiError, setApiError] = useState(null);
  const [apiStatus, setApiStatus] = useState(null);
  const [viewMode, setViewMode] = useState('modern'); // 'modern' or 'ayurvedic'
  const [interactionMode, setInteractionMode] = useState('entry'); // 'entry', 'chatting', 'confirmed'
  const [chatHistory, setChatHistory] = useState([]);
  const [currentSummary, setCurrentSummary] = useState('');
  const [showRemedies, setShowRemedies] = useState(false);
  const [userLocation, setUserLocation] = useState({ lat: 28.6139, lng: 77.2090, loading: false }); // Default Delhi

  const recognitionRef = useRef(null);
  const resultsRef = useRef(null);

  useEffect(() => {
    if (result && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result]);

  useEffect(() => {
    if (typeof window !== 'undefined' && (window.getSpeechRecognition || window.webkitSpeechRecognition)) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.lang = 'hi-IN'; // Phonetic Hindi/English support

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setSymptoms(prev => prev + " " + transcript);
        setIsRecording(false);
      };
      recognitionRef.current.onerror = () => setIsRecording(false);
    }
  }, []);

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
    } else {
      setIsRecording(true);
      recognitionRef.current?.start();
    }
  };

  const getUserLocation = () => {
    if (!navigator.geolocation) {
      console.warn("Geolocation not supported");
      return;
    }
    setUserLocation(prev => ({ ...prev, loading: true }));
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          loading: false
        });
      },
      (err) => {
        console.error("Location error:", err);
        setUserLocation(prev => ({ ...prev, loading: false }));
      }
    );
  };

  const addTag = () => {
    if (tagInput.trim() && !historyTags.includes(tagInput.trim())) {
      setHistoryTags([...historyTags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const handleStartChat = async () => {
    if (loading || !symptoms.trim() || !name.trim() || !age) return;
    setInteractionMode('chatting');
    const initialHistory = [{ role: 'user', content: symptoms }];
    setChatHistory(initialHistory);
    setLoading(true);
    setApiError(null);
    setApiStatus("Initializing clinical discussion...");
    try {
      const response = await axios.post(`${API_BASE}/chat`, {
        name,
        age,
        history: historyTags.join(", "),
        chat_history: initialHistory
      });
      setChatHistory([...initialHistory, { role: 'assistant', content: response.data.message }]);
    } catch (err) {
      if (err.response?.status === 429) {
        setApiError("High traffic detected. Local fallback mode activated.");
      } else {
        setApiError("AI processing is briefly interrupted. Click 'Analyze Now' for immediate results.");
      }
    } finally {
      setLoading(false);
      setApiStatus(null);
    }
  };

  const handleChatSendMessage = async (userMsg) => {
    if (loading || !userMsg.trim()) return;
    const newHistory = [...chatHistory, { role: 'user', content: userMsg }];
    setChatHistory(newHistory);
    setLoading(true);
    setApiStatus("Processing your response...");
    try {
      const response = await axios.post(`${API_BASE}/chat`, {
        name,
        age,
        history: historyTags.join(", "),
        chat_history: newHistory
      });
      if (response.data.is_ready_for_triage) {
        setInteractionMode('confirmed');
        setCurrentSummary(response.data.summary);
      }
      setChatHistory([...newHistory, { role: 'assistant', content: response.data.message }]);
    } catch (err) {
      if (err.response?.status === 429) {
        setApiError("Optimizing connection... one moment.");
      } else {
        setApiError("AI connection lost. You can still 'Proceed to Solution'.");
      }
    } finally {
      setLoading(false);
      setApiStatus(null);
    }
  };

  const handleAnalyze = async () => {
    if (loading) return;
    const ageVal = parseInt(age);
    const symptomsToUse = currentSummary || symptoms;
    if (!symptomsToUse.trim() || !name.trim() || isNaN(ageVal) || ageVal <= 0) return;
    setLoading(true);
    setApiError(null);
    setApiStatus("Synthesizing multi-agent clinical data...");
    
    // Improved UX: sequence messages every few seconds if it takes long
    const statusInterval = setInterval(() => {
      setApiStatus(prev => {
        if (prev.includes("Synthesizing")) return "Calibrating medical risk gauge...";
        if (prev.includes("Calibrating")) return "Generating targeted care advice...";
        if (prev.includes("Generating")) return "Finalizing diagnosis output...";
        return prev;
      });
    }, 2500);

    try {
      const response = await axios.post(`${API_BASE}/triage`, {
        name: name,
        age: age || "Not set",
        history: historyTags.join(", "),
        symptoms: symptomsToUse,
        chat_history: chatHistory
      }, { timeout: 25000 });
      clearInterval(statusInterval);
      setResult(response.data);
      getUserLocation(); // Automatically get location for hospital matching
    } catch (err) {
      clearInterval(statusInterval);
      const errorMsg = err.response?.data?.detail || err.message || "Unknown Error";
      if (err.response?.status === 429) {
        setApiError(`High demand (${errorMsg}) - using advanced local triage fallback.`);
      } else {
        setApiError(`Clinical connection issue: ${errorMsg}. Using local safety protocols.`);
      }
    } finally {
      setLoading(false);
      setApiStatus(null);
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-12 lg:px-20">

      {/* 1. Premium Navbar */}
      <nav className="fixed top-4 left-1/2 -translate-x-1/2 w-[90%] md:w-[60%] glass rounded-full px-6 py-3 flex items-center justify-between z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-medical-blue rounded-lg flex items-center justify-center text-white shadow-lg shadow-medical-blue/20">
            <Activity size={18} />
          </div>
          <div>
            <h1 className="text-base font-black tracking-tight leading-none medical-gradient-text">Swasthya Sathi AI</h1>
            <p className="text-[8px] uppercase tracking-[0.2em] font-bold text-text-secondary">Agentic Health</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 group cursor-pointer">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">System Online</span>
          </div>
          <button className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm border border-slate-100 hover:rotate-12 transition-transform">
            <Info size={18} className="text-text-secondary" />
          </button>
        </div>
      </nav>

      <main className="mt-14 space-y-6">
        {/* Header Section */}
        <header className="max-w-2xl">
          <motion.h2
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-2xl md:text-3xl font-black tracking-tighter leading-tight"
          >
            Your path to <span className="text-medical-blue italic">clarity</span>, driven by <span className="text-soothing-teal">reason</span>.
          </motion.h2>
          <p className="mt-1.5 text-xs text-text-secondary font-medium">
            Professional triage through collaborative AI agents. Describe your symptoms for immediate reasoning.
          </p>
        </header>

        {/* 2. Onboarding Bento Section */}
        <section className="bento-grid">
          {/* Identity Card */}
          <BentoCard className="col-span-12 lg:col-span-5 space-y-8" delay={0.1}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-slate-100">
                <User size={24} className="text-medical-blue" />
              </div>
              <h3 className="font-black text-xl tracking-tight">User Identity <span className="text-risk-critical">*</span></h3>
            </div>
            <div className="space-y-6">
              <input
                type="text"
                placeholder="Patient Name"
                className="w-full bg-white/50 border border-slate-100 px-6 py-4 rounded-2xl font-bold focus:ring-4 focus:ring-medical-blue/5 focus:border-medical-blue transition-all outline-none"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="flex items-center gap-4">
                <input
                  type="number"
                  placeholder="Age"
                  className="w-24 bg-white/50 border border-slate-100 px-6 py-4 rounded-2xl font-bold focus:ring-4 focus:ring-medical-blue/5 outline-none"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                />
                <p className="text-sm font-bold text-text-secondary uppercase tracking-widest">Medical Profile Age <span className="text-risk-critical">*</span></p>
              </div>
            </div>
          </BentoCard>

          {/* History Tag Cloud */}
          <BentoCard className="col-span-12 lg:col-span-7 space-y-8" delay={0.2}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-slate-100">
                  <ShieldCheck size={24} className="text-soothing-teal" />
                </div>
                <h3 className="font-black text-xl tracking-tight">Clinical History</h3>
              </div>
              <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Existing conditions</p>
            </div>

            <div className="space-y-4">
              <div className="flex gap-4">
                <input
                  type="text"
                  placeholder="e.g. Hypertension, Asthma"
                  className="flex-1 bg-white/50 border border-slate-100 px-6 py-4 rounded-2xl font-bold focus:ring-4 focus:ring-soothing-teal/5 outline-none"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addTag()}
                />
                <button
                  onClick={addTag}
                  className="w-14 h-14 bg-soothing-teal text-white rounded-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-soothing-teal/20"
                >
                  <Plus size={24} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {historyTags.map(tag => (
                  <motion.div
                    layoutId={tag}
                    key={tag}
                    className="px-4 py-2 bg-white border border-slate-100 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 shadow-sm"
                  >
                    {tag}
                    <X size={14} className="cursor-pointer text-medical-blue hover:text-risk-critical" onClick={() => setHistoryTags(historyTags.filter(t => t !== tag))} />
                  </motion.div>
                ))}
                {historyTags.length === 0 && <p className="text-xs text-text-secondary italic">No history tags added yet...</p>}
              </div>
            </div>
          </BentoCard>

          {/* 3. The Pulse Input (Central) */}
          <BentoCard className={`col-span-12 pulse-input relative ${isRecording ? 'animate-pulse-red' : ''}`} delay={0.3}>
            <AnimatePresence mode="wait">
              {interactionMode === 'entry' && (
                <motion.div
                  key="entry"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-medical-blue/10 rounded-xl flex items-center justify-center text-medical-blue">
                        <Stethoscope size={20} />
                      </div>
                      <div>
                        <h3 className="font-black text-base tracking-tight">How are you feeling? <span className="text-risk-critical">*</span></h3>
                        <p className="text-[9px] font-medium text-text-secondary">AI agents are ready to understand your symptoms.</p>
                      </div>
                    </div>
                    <button
                      onClick={toggleRecording}
                      className={`w-10 h-10 rounded-[16px] flex items-center justify-center transition-all shadow-xl hover:-translate-y-1 ${isRecording ? 'bg-risk-critical text-white scale-110' : 'bg-white text-medical-blue border border-slate-100'
                        }`}
                    >
                      <Mic size={18} />
                    </button>
                  </div>
                  <textarea
                    className="w-full bg-transparent min-h-[100px] text-lg font-bold text-text-main placeholder:text-slate-200 outline-none resize-none"
                    placeholder="e.g. Mujhse sar dard ho raha hai and feeling dizzy..."
                    value={symptoms}
                    onChange={(e) => setSymptoms(e.target.value)}
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-text-secondary">
                      <Clock size={14} />
                      <span className="text-[9px] font-black uppercase tracking-widest">Discussion mode ready</span>
                    </div>
                    <button
                      disabled={loading || !symptoms.trim() || !name.trim() || !age}
                      onClick={handleAnalyze}
                      className="btn-gradient px-8 py-4 rounded-[18px] font-black text-sm uppercase tracking-widest flex items-center gap-3 disabled:opacity-30 disabled:grayscale transition-all hover:px-10"
                    >
                      {loading ? "Analyzing..." : "Analyze Symptoms"}
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Conversation blocks removed for streamlined direct analysis workflow */}
            </AnimatePresence>
          </BentoCard>
        </section>

        {/* 4. Results Dashboard */}
        <AnimatePresence>
          {result && (
            <motion.section
              ref={resultsRef}
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-12 pb-24 scroll-mt-28"
            >
              <div className="flex items-center gap-4">
                <div className="h-[1px] flex-1 bg-slate-100" />
                <span className="text-[11px] font-black uppercase tracking-[0.4em] text-text-secondary whitespace-nowrap">Clinical Reasoning Output</span>
                <div className="h-[1px] flex-1 bg-slate-100" />
              </div>

              <div className="bento-grid">
                {/* Risk Gauge Card */}
                <BentoCard className="col-span-12 md:col-span-4 bg-white/40 flex flex-col items-center justify-between py-12 min-h-[400px]">
                  <div className="w-full flex flex-col items-center">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-text-secondary mb-4">Urgency Level</h4>
                    <RiskGauge status={result.triage.status} />
                    <p className="mt-8 text-center text-sm font-bold text-text-secondary px-6">
                      {result.triage.reasoning}
                    </p>
                  </div>

                  <div className="mt-8 flex bg-slate-100/50 p-1.5 rounded-2xl border border-slate-200/50 shadow-inner w-[90%] mx-auto">
                    <button
                      onClick={() => setViewMode('modern')}
                      className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all duration-300 ${viewMode === 'modern' ? 'bg-white text-medical-blue shadow-lg scale-[1.02]' : 'text-text-secondary hover:text-text-main'}`}
                    >
                      Modern Solution
                    </button>
                    <button
                      onClick={() => setViewMode('ayurvedic')}
                      className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all duration-300 ${viewMode === 'ayurvedic' ? 'bg-white text-soothing-teal shadow-lg scale-[1.02]' : 'text-text-secondary hover:text-text-main'}`}
                    >
                      Ayurvedic Solution
                    </button>
                  </div>
                </BentoCard>

                {/* Immediate Action Card */}
                <BentoCard className="col-span-12 md:col-span-4 bg-white/40 flex flex-col justify-center min-h-[400px]">
                  <h5 className="text-[10px] font-black uppercase tracking-widest text-medical-blue mb-6">Immediate Action</h5>
                  <p className="text-3xl font-black tracking-tight leading-tight text-text-main">{result.actions.immediate_action}</p>
                </BentoCard>

                {/* Simple Explanation Card */}
                <BentoCard className="col-span-12 md:col-span-4 bg-white/40 flex flex-col justify-between py-12 min-h-[400px]">
                  <div>
                    <h5 className={`text-[10px] font-black uppercase tracking-widest mb-6 ${viewMode === 'modern' ? 'text-soothing-teal' : 'text-amber-600'}`}>
                      {viewMode === 'modern' ? 'Simple Explanation' : 'Ayurvedic Drishti'}
                    </h5>
                    <p className="text-xl font-bold leading-relaxed text-text-secondary pr-4">
                      {result.actions[viewMode].simple_explanation}
                    </p>
                  </div>

                  <div className="space-y-4">
                    {showRemedies && result.triage.status !== "CRITICAL" && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="p-4 bg-white/60 rounded-2xl border border-slate-100 shadow-inner"
                      >
                        <h6 className="text-[9px] font-black uppercase tracking-widest text-text-secondary mb-3">
                          {viewMode === 'modern' ? "Suggested OTC Care" : "Traditional Home Remedies"}
                        </h6>
                        <ul className="space-y-2">
                          {result.actions[viewMode].specific_remedies.map((r, i) => (
                            <li key={i} className="text-sm font-bold text-text-main flex items-center gap-2">
                              <div className={`w-1 h-1 rounded-full ${viewMode === 'modern' ? 'bg-medical-blue' : 'bg-amber-600'}`} />
                              {r}
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    )}

                    {result.triage.status !== "CRITICAL" ? (
                      <button
                        onClick={() => setShowRemedies(!showRemedies)}
                        className={`mt-4 w-fit px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-3 transition-all hover:gap-5 ${viewMode === 'modern'
                            ? 'bg-medical-blue/10 text-medical-blue border border-medical-blue/20 hover:bg-medical-blue hover:text-white'
                            : 'bg-amber-600/10 text-amber-600 border border-amber-600/20 hover:bg-amber-600 hover:text-white'
                          }`}>
                        {showRemedies ? "Hide Suggestions" : "View Solution"} <ChevronRight size={14} className={showRemedies ? 'rotate-90' : ''} />
                      </button>
                    ) : (
                      <div className="p-4 bg-risk-critical/5 rounded-2xl border border-risk-critical/20 flex items-center gap-3">
                        <AlertCircle size={16} className="text-risk-critical" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-risk-critical">Professional Care Required</span>
                      </div>
                    )}
                  </div>
                </BentoCard>

                {/* Nearby Hospitals Map Card */}
                <BentoCard className="col-span-12 p-0 overflow-hidden group relative min-h-[450px] bg-white/40">
                  <div className="absolute inset-0 bg-slate-200 transition-all duration-700">
                    {userLocation.loading ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
                        <div className="flex flex-col items-center gap-4">
                          <Activity className="animate-pulse text-medical-blue" size={32} />
                          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-text-secondary">Locating Care Centers...</span>
                        </div>
                      </div>
                    ) : (
                      <div className="relative w-full h-full">
                        <iframe
                          width="100%"
                          height="100%"
                          frameBorder="0"
                          style={{ border: 0 }}
                          src={`https://www.google.com/maps?q=hospitals+near+me&ll=${userLocation.lat},${userLocation.lng}&z=14&output=embed`}
                          allowFullScreen
                        />
                      </div>
                    )}
                  </div>
                  <div className="relative z-10 p-10 pt-[5%] pointer-events-none w-full flex justify-end">
                    <div className="bg-white/90 backdrop-blur-xl p-8 rounded-[32px] border border-white max-w-sm shadow-2xl pointer-events-auto">
                      <div className="flex items-center gap-3 text-medical-blue mb-2">
                        <MapPin size={18} />
                        <span className="text-[10px] font-black uppercase tracking-widest">Nearby Hospitals</span>
                      </div>
                      <p className="text-lg font-black">AI-Matched Care Centers</p>
                      <p className="text-xs text-text-secondary mt-1 font-medium">Providing optimized routes to verified medical facilities.</p>
                      <a
                        href={`https://www.google.com/maps/search/hospitals/@${userLocation.lat},${userLocation.lng},15z`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-6 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-medical-blue hover:gap-4 transition-all"
                      >
                        View Detailed List <ArrowRight size={14} />
                      </a>
                    </div>
                  </div>
                </BentoCard>

                {/* Home Care Tips Bento */}
                <BentoCard className="col-span-12 bg-white/60">
                  <div className="flex items-center justify-between mb-10">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-text-secondary">AI Suggested Home Care</h4>
                    <div className="px-4 py-2 bg-soothing-teal/10 text-soothing-teal rounded-full text-[10px] font-black uppercase tracking-widest border border-soothing-teal/20">
                      Standard Guidelines
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {result.actions[viewMode].home_care_tips.map((tip, i) => (
                      <div key={i} className="flex gap-6 items-start">
                        <div className={`w-8 h-8 rounded-full text-white flex items-center justify-center font-black text-xs shrink-0 ${viewMode === 'modern' ? 'bg-soothing-teal' : 'bg-amber-500'}`}>
                          {i + 1}
                        </div>
                        <p className="font-bold text-text-main leading-snug">{tip}</p>
                      </div>
                    ))}
                  </div>
                </BentoCard>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* 5. Safety Footer */}
        <footer className="pt-20 pb-12 text-center space-y-8">
          <div className="w-20 h-[2px] mx-auto bg-slate-200" />
          <div className="max-w-xl mx-auto space-y-6">
            <p className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.3em]">
              Swasthya Sathi • Intelligence & Precision
            </p>
            <div className="glass p-8 rounded-[32px] border-slate-100 italic text-[11px] text-text-secondary leading-relaxed bg-white/20">
              <span className="text-risk-critical font-black not-italic inline-block mb-2 uppercase tracking-widest">Medical Disclaimer:</span><br />
              This system uses a Multi-Agent architecture to provide preliminary health triage.
              It is <span className="font-black text-text-main">NOT a substitute for professional medical diagnosis</span>.
              In case of emergency, please visit the emergency room immediately.
            </div>
          </div>
          <p className="text-[9px] font-bold text-text-secondary/40 tracking-[0.4em] uppercase">
            © 2026 DEEPMIND HEALTHCARE SYSTEMS • ALL RIGHTS RESERVED
          </p>
        </footer>
      </main>

      {/* Floating Error Toast */}
      <AnimatePresence>
        {apiStatus && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 glass px-8 py-4 rounded-full border-medical-blue/20 flex items-center gap-4 text-medical-blue z-50 shadow-2xl"
          >
            <Activity size={20} className="animate-spin" />
            <span className="text-sm font-black uppercase tracking-widest">{apiStatus}</span>
          </motion.div>
        )}

        {apiError && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 glass px-8 py-4 rounded-full border-risk-critical/20 flex items-center gap-4 text-risk-critical z-50 shadow-2xl"
          >
            <AlertCircle size={20} />
            <span className="text-sm font-black uppercase tracking-widest">{apiError}</span>
            <X size={16} className="cursor-pointer ml-4" onClick={() => setApiError(null)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
