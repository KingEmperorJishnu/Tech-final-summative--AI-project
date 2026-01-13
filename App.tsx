
import React, { useState, useEffect, useRef } from 'react';
import { AppStatus, Prediction, FeedbackHistory } from './types';
import { getInsightForClass, processFeedback } from './services/geminiService';

declare global {
  interface Window {
    tmImage: any;
  }
}

const DEFAULT_MODEL_URL = 'https://teachablemachine.withgoogle.com/models/qPzd94cSh/';

type InputSource = 'DRIVE' | 'CAMERA';

const App: React.FC = () => {
  // Model Settings
  const [modelUrl, setModelUrl] = useState<string>(() => {
    return localStorage.getItem('tm_model_url') || DEFAULT_MODEL_URL;
  });
  const [showSettings, setShowSettings] = useState<boolean>(false);
  
  // App State
  const [status, setStatus] = useState<AppStatus>(AppStatus.LOADING_MODEL);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [insight, setInsight] = useState<string | null>(null);
  const [isInsightLoading, setIsInsightLoading] = useState<boolean>(false);
  
  // Input Selection
  const [inputSource, setInputSource] = useState<InputSource>('DRIVE');
  const [targetImage, setTargetImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [shouldFlip, setShouldFlip] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  
  // Feedback and Correction States
  const [predictionIndex, setPredictionIndex] = useState<number>(0);
  const [isManualInput, setIsManualInput] = useState<boolean>(false);
  const [manualValue, setManualValue] = useState<string>('');
  const [feedbackGiven, setFeedbackGiven] = useState<boolean>(false);
  const [feedbackResponse, setFeedbackResponse] = useState<string | null>(null);
  const [feedbackHistory, setFeedbackHistory] = useState<FeedbackHistory[]>(() => {
    const saved = localStorage.getItem('tm_feedback_history');
    return saved ? JSON.parse(saved) : [];
  });
  
  // Refs
  const modelRef = useRef<any>(null);
  const imageElementRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const loadModel = async (url: string) => {
    try {
      setStatus(AppStatus.LOADING_MODEL);
      setError(null);
      const formattedUrl = url.endsWith('/') ? url : `${url}/`;
      const modelURL = `${formattedUrl}model.json`;
      const metadataURL = `${formattedUrl}metadata.json`;
      const model = await window.tmImage.load(modelURL, metadataURL);
      modelRef.current = model;
      localStorage.setItem('tm_model_url', formattedUrl);
      setStatus(AppStatus.READY);
    } catch (err: any) {
      console.error("Model Loading Error:", err);
      setError("Failed to load model. Check your Teachable Machine link.");
      setStatus(AppStatus.ERROR);
    }
  };

  useEffect(() => {
    loadModel(modelUrl);
    return () => stopCamera();
  }, []);

  useEffect(() => {
    localStorage.setItem('tm_feedback_history', JSON.stringify(feedbackHistory));
  }, [feedbackHistory]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      console.error("Camera Error:", err);
      setError("Camera access denied.");
      setInputSource('DRIVE');
    }
  };

  useEffect(() => {
    if (inputSource === 'CAMERA') {
      startCamera();
    } else {
      stopCamera();
    }
  }, [inputSource]);

  const resetFeedback = () => {
    setPredictionIndex(0);
    setIsManualInput(false);
    setManualValue('');
    setFeedbackGiven(false);
    setFeedbackResponse(null);
    setInsight(null);
    setIsInsightLoading(false);
  };

  const getProcessedCanvas = () => {
    const canvas = processingCanvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    canvas.width = 224;
    canvas.height = 224;
    let source: HTMLImageElement | HTMLVideoElement | null = null;
    let sw = 0, sh = 0;
    if (inputSource === 'CAMERA' && videoRef.current) {
      source = videoRef.current;
      sw = videoRef.current.videoWidth;
      sh = videoRef.current.videoHeight;
    } else if (imageElementRef.current) {
      source = imageElementRef.current;
      sw = imageElementRef.current.naturalWidth;
      sh = imageElementRef.current.naturalHeight;
    }
    if (!source || sw === 0 || sh === 0) return null;
    const size = Math.min(sw, sh);
    const offsetX = (sw - size) / 2;
    const offsetY = (sh - size) / 2;
    ctx.clearRect(0, 0, 224, 224);
    if (shouldFlip) { ctx.translate(224, 0); ctx.scale(-1, 1); }
    ctx.drawImage(source, offsetX, offsetY, size, size, 0, 0, 224, 224);
    return canvas;
  };

  const analyzeImage = async () => {
    if (!modelRef.current) return;
    try {
      setStatus(AppStatus.RUNNING);
      resetFeedback();
      const processedInput = getProcessedCanvas();
      if (!processedInput) throw new Error("Input source unavailable");
      const results = await modelRef.current.predict(processedInput);
      const sortedResults = [...results].sort((a: Prediction, b: Prediction) => b.probability - a.probability);
      setPredictions(sortedResults);
      if (sortedResults.length > 0 && sortedResults[0].probability > 0.05) {
        setIsInsightLoading(true);
        const geminiInsight = await getInsightForClass(sortedResults[0].className);
        setInsight(geminiInsight);
        setIsInsightLoading(false);
      } else {
        setInsight("Subject unrecognized.");
      }
      setStatus(AppStatus.READY);
    } catch (err: any) {
      console.error("Analysis Error:", err);
      setError("Analysis engine error.");
      setStatus(AppStatus.ERROR);
    }
  };

  const addFeedbackToLog = (original: string, corrected: string, type: 'CORRECTION' | 'CONFIRMATION') => {
    const entry: FeedbackHistory = {
      timestamp: Date.now(),
      originalLabel: original,
      correctedLabel: corrected,
      type
    };
    const newHistory = [entry, ...feedbackHistory].slice(0, 5);
    setFeedbackHistory(newHistory);
    localStorage.setItem('tm_feedback_history', JSON.stringify(newHistory));
  };

  const handleCorrectFeedback = async () => {
    const currentLabel = predictions[predictionIndex]?.className || "Unknown";
    setFeedbackGiven(true);
    addFeedbackToLog(currentLabel, currentLabel, 'CONFIRMATION');
    const response = await processFeedback(currentLabel, true);
    setFeedbackResponse(response);
    
    // Auto-reload after feedback to simulate learning update and clear state
    setTimeout(() => {
      window.location.reload();
    }, 4000);
  };

  const handleWrongFeedback = async () => {
    if (predictionIndex === 0 && predictions.length > 1 && predictions[1].probability > 0.05) {
      const nextIndex = 1;
      setPredictionIndex(nextIndex);
      setInsight(null);
      setIsInsightLoading(true);
      const nextLabel = predictions[nextIndex].className;
      const geminiInsight = await getInsightForClass(nextLabel);
      setInsight(geminiInsight);
      setIsInsightLoading(false);
    } else {
      setIsManualInput(true);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualValue.trim()) return;
    const original = predictions[predictionIndex]?.className || "Unknown";
    setFeedbackGiven(true);
    addFeedbackToLog(original, manualValue, 'CORRECTION');
    const response = await processFeedback(manualValue, false); 
    setFeedbackResponse(`Recorded "${manualValue}" as correction. Refreshing module...`);
    
    // Auto-reload after feedback to simulate learning update
    setTimeout(() => {
      window.location.reload();
    }, 4000);
  };

  const handleTargetImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setTargetImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
        resetFeedback();
        setPredictions([]);
      };
      reader.readAsDataURL(file);
    }
  };

  const currentPred = predictions[predictionIndex];

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center max-w-6xl mx-auto selection:bg-amber-500/30">
      <canvas ref={processingCanvasRef} className="hidden" />

      {/* Settings Panel */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-3xl p-8 shadow-2xl">
            <h2 className="text-2xl font-black text-amber-500 mb-2 uppercase tracking-tight">Model Configuration</h2>
            <p className="text-slate-400 text-xs mb-6 font-bold uppercase tracking-widest">Update your Teachable Machine endpoint</p>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Exported URL</label>
                <input 
                  type="text" 
                  value={modelUrl} 
                  onChange={(e) => setModelUrl(e.target.value)}
                  placeholder="https://teachablemachine.withgoogle.com/models/..."
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 focus:border-amber-500 outline-none"
                />
              </div>
              <div className="flex gap-3 mt-4">
                <button 
                  onClick={() => { loadModel(modelUrl); setShowSettings(false); }}
                  className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-black py-3 rounded-xl uppercase text-[10px] tracking-widest transition-colors"
                >
                  Reload Model
                </button>
                <button onClick={() => setShowSettings(false)} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-black py-3 rounded-xl uppercase text-[10px] tracking-widest transition-colors">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <header className="w-full flex flex-col items-center mb-10 relative">
        <button 
          onClick={() => setShowSettings(true)}
          className="absolute right-0 top-0 p-3 bg-slate-800/50 hover:bg-slate-800 rounded-full border border-slate-700 transition-all group"
        >
          <svg className="w-5 h-5 text-slate-500 group-hover:text-amber-500 group-hover:rotate-90 transition-all duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </button>
        <h1 className="text-5xl md:text-7xl font-black bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-500 bg-clip-text text-transparent mb-4 tracking-tighter uppercase drop-shadow-sm font-brand">Can I Read It?</h1>
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="h-px w-12 bg-slate-800"></div>
          <p className="text-slate-500 uppercase tracking-[0.3em] text-[10px] font-bold">Neural Vision Assistant</p>
          <div className="h-px w-12 bg-slate-800"></div>
        </div>
      </header>

      {status === AppStatus.ERROR && (
        <div className="w-full max-w-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 p-4 rounded-xl mb-8 text-center font-bold animate-in fade-in slide-in-from-top-4">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full">
        <div className="lg:col-span-6 flex flex-col gap-6">
          <section className="bg-slate-900/50 border border-slate-800 p-6 md:p-8 rounded-3xl shadow-2xl backdrop-blur-sm relative overflow-hidden">
            {status === AppStatus.LOADING_MODEL && (
              <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-md flex flex-col items-center justify-center z-20">
                <div className="w-12 h-12 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mb-4"></div>
                <p className="text-amber-500 font-black uppercase tracking-[0.2em] text-[10px]">Syncing Brain...</p>
              </div>
            )}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button onClick={() => setInputSource('DRIVE')} className={`px-4 py-2 rounded-lg text-[10px] font-black transition-all uppercase tracking-widest ${inputSource === 'DRIVE' ? 'bg-amber-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Drive / Files</button>
                <button onClick={() => setInputSource('CAMERA')} className={`px-4 py-2 rounded-lg text-[10px] font-black transition-all uppercase tracking-widest ${inputSource === 'CAMERA' ? 'bg-amber-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Live Camera</button>
              </div>
              <button onClick={() => setShouldFlip(!shouldFlip)} className={`flex items-center gap-2 px-3 py-2 rounded-full border transition-all ${shouldFlip ? 'bg-amber-500/20 border-amber-500 text-amber-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
                <span className="text-[9px] font-black uppercase tracking-widest">{shouldFlip ? 'Mirrored' : 'Mirror OFF'}</span>
              </button>
            </div>
            <div className="relative w-full h-80 rounded-3xl overflow-hidden border-2 border-slate-800 bg-slate-950/50 group">
              {inputSource === 'CAMERA' ? (
                <div className="relative w-full h-full">
                  <video ref={videoRef} autoPlay playsInline className={`w-full h-full object-cover ${shouldFlip ? '-scale-x-100' : ''}`} />
                  {!isCameraActive && <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50"><p className="text-slate-500 font-bold uppercase text-[10px]">Initializing...</p></div>}
                  <div className="absolute inset-0 border-[40px] border-slate-950/40 pointer-events-none flex items-center justify-center">
                    <div className="w-full h-full border-2 border-amber-500/30 rounded-xl"></div>
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-full cursor-pointer hover:bg-amber-500/5 transition-colors">
                  {imagePreview ? (
                    <img ref={imageElementRef} src={imagePreview} alt="Preview" className={`w-full h-full object-contain p-4 transition-all ${shouldFlip ? '-scale-x-100' : ''}`} />
                  ) : (
                    <div className="flex flex-col items-center p-6 text-center">
                      <div className="w-16 h-16 mb-4 bg-slate-900 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform"><svg className="w-8 h-8 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg></div>
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Upload to Module</span>
                    </div>
                  )}
                  <input type="file" accept="image/*" className="hidden" onChange={handleTargetImageChange} />
                </label>
              )}
            </div>
            <button onClick={analyzeImage} disabled={(inputSource === 'DRIVE' && !targetImage) || (inputSource === 'CAMERA' && !isCameraActive) || status === AppStatus.RUNNING} className={`mt-8 w-full py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all shadow-lg ${((inputSource === 'DRIVE' && !targetImage) || (inputSource === 'CAMERA' && !isCameraActive)) ? 'bg-slate-800 text-slate-600' : 'bg-amber-600 text-white'}`}>
              {status === AppStatus.RUNNING ? 'Analyzing...' : 'Analyze Current Frame'}
            </button>
          </section>

          {/* Feedback History Log */}
          {feedbackHistory.length > 0 && (
            <section className="bg-slate-900/30 border border-slate-800 p-6 rounded-3xl animate-in slide-in-from-left-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Memory Log</h3>
                <button onClick={() => { setFeedbackHistory([]); localStorage.removeItem('tm_feedback_history'); }} className="text-[9px] font-black text-rose-500/60 uppercase">Clear</button>
              </div>
              <div className="flex flex-col gap-2">
                {feedbackHistory.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center p-3 bg-slate-950/50 rounded-xl border border-white/5">
                    <div className="flex flex-col">
                      <span className={`text-[9px] font-black uppercase ${item.type === 'CORRECTION' ? 'text-rose-400' : 'text-emerald-400'}`}>{item.type}</span>
                      <span className="text-slate-300 text-xs font-bold">{item.correctedLabel}</span>
                    </div>
                    <span className="text-[8px] font-black text-slate-600 uppercase">{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Result Area */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          <section className="bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950 border border-amber-900/30 p-10 rounded-3xl shadow-2xl relative overflow-hidden min-h-[550px] flex flex-col">
            <div className="mb-6 flex justify-between items-center"><span className="text-amber-500/60 text-[10px] font-black uppercase tracking-[0.3em]">{isManualInput ? 'Manual Entry' : predictions.length > 0 ? 'Detected Signal' : 'Awaiting Input'}</span></div>
            <div className="h-px w-full bg-slate-800 mb-8"></div>
            <div className="flex flex-col flex-1 justify-center">
              {isManualInput && !feedbackGiven ? (
                <form onSubmit={handleManualSubmit} className="flex flex-col items-center gap-6">
                  <h3 className="text-amber-400 font-brand font-black text-xl uppercase tracking-tighter">Enter Correct Label</h3>
                  <input autoFocus type="text" value={manualValue} onChange={(e) => setManualValue(e.target.value)} placeholder="Type label..." className="w-full max-w-sm bg-slate-950 border-2 border-slate-800 text-white px-6 py-5 rounded-2xl text-3xl font-black text-center outline-none focus:border-amber-500 shadow-2xl" />
                  <button type="submit" className="px-10 py-4 bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg">Log Feedback</button>
                  <button type="button" onClick={() => setIsManualInput(false)} className="text-[9px] text-slate-500 uppercase font-black hover:text-slate-300">Cancel</button>
                </form>
              ) : predictions.length > 0 ? (
                <div className="flex flex-col items-center justify-center py-6 animate-in slide-in-from-bottom-6">
                  <div className="text-8xl md:text-9xl font-black text-white mb-6 font-brand tracking-tighter bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent">{currentPred.className}</div>
                  <div className="flex items-center gap-3 bg-slate-950/40 px-6 py-2 rounded-full border border-white/5 mb-10">
                    <span className="text-slate-400 font-black text-[10px] uppercase tracking-[0.2em]">{(currentPred.probability * 100).toFixed(0)}% Certainty</span>
                  </div>
                  {!feedbackGiven && (
                    <div className="w-full flex flex-col gap-3 max-w-xs">
                      <button onClick={handleCorrectFeedback} className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black text-[11px] uppercase transition-all shadow-lg active:scale-95">Yes, Correct</button>
                      <button onClick={handleWrongFeedback} className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-2xl font-black text-[11px] uppercase transition-all active:scale-95">Incorrect Guess</button>
                      <button onClick={() => setIsManualInput(true)} className="mt-2 text-[9px] text-slate-500 font-black uppercase hover:text-amber-500 transition-colors text-center">Add to Memory Module</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12"><div className="text-9xl font-black text-white/5 font-brand tracking-tighter select-none mb-4">READY</div></div>
              )}
            </div>

            {(insight || feedbackGiven || isInsightLoading) && (
              <div className="mt-8 p-6 bg-slate-950/60 border-l-4 border-amber-500 rounded-r-2xl animate-in slide-in-from-right-4 shadow-xl">
                {isInsightLoading ? (
                  <div className="flex items-center gap-3"><div className="w-3 h-3 bg-amber-500 rounded-full animate-ping"></div><span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Loading...</span></div>
                ) : !feedbackGiven ? (
                  <>
                    <div className="flex items-center gap-2 mb-3"><span className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Neural Insight</span></div>
                    <p className="text-slate-200 text-lg leading-relaxed italic">"{insight}"</p>
                  </>
                ) : (
                  <div className="animate-in fade-in"><p className="text-amber-400 text-sm font-bold flex items-center gap-4"><span className="leading-tight">{feedbackResponse}</span></p></div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
      <footer className="mt-16 text-slate-700 text-[9px] flex flex-col md:flex-row gap-8 items-center border-t border-slate-800/30 pt-10 w-full justify-between opacity-60">
        <div className="px-3 py-1 bg-slate-800/50 rounded font-black tracking-[0.2em] text-amber-500/80">VisionQuest v2.0.0</div>
        <div className="flex gap-10 font-black uppercase tracking-widest"><a href="#" className="hover:text-amber-500">Auto-Feedback Reload Active</a></div>
      </footer>
    </div>
  );
};

export default App;
