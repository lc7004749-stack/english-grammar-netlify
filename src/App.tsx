import React, { useState, useEffect, useRef } from 'react';
import { UploadedImage, LoadingState, SavedProblem } from './types';
import ImageUploader from './components/ImageUploader';
import SolutionViewer from './components/SolutionViewer';
import ProblemLibrary from './components/ProblemLibrary';
import { solveProblem, verifyProblem, generateDrills, generateSpeech, decodeBase64, decodePcmAudio } from './services/geminiService';
import { BookOpen, Sparkles, CheckCircle, GraduationCap, Zap, Loader2, RotateCcw, X, Download, Printer, ArrowRight, MonitorPlay } from 'lucide-react';

const STORAGE_KEYS = {
  TEXT_INPUT: 'ai_tutor_text_input',
  VERIFICATION_RESULT: 'ai_tutor_verification_result',
  SOLUTION: 'ai_tutor_solution',
  SAVED_PROBLEMS: 'ai_tutor_saved_problems',
  DRILLS: 'ai_tutor_drills'
};

const App: React.FC = () => {
  const [selectedImage, setSelectedImage] = useState<UploadedImage | null>(null);
  const [textInput, setTextInput] = useState<string>("");
  const [verificationResult, setVerificationResult] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [solution, setSolution] = useState<string>("");
  const [drills, setDrills] = useState<string>("");
  const [isGeneratingDrills, setIsGeneratingDrills] = useState(false);
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  const [error, setError] = useState<string>("");
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [savedProblems, setSavedProblems] = useState<SavedProblem[]>([]);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newProblemTags, setNewProblemTags] = useState<string>("");
  const [analysisReportHtml, setAnalysisReportHtml] = useState<string | null>(null);
  
  // Learning Mode State
  const [isLearningMode, setIsLearningMode] = useState(false);

  useEffect(() => {
    const saved = {
      text: localStorage.getItem(STORAGE_KEYS.TEXT_INPUT),
      ver: localStorage.getItem(STORAGE_KEYS.VERIFICATION_RESULT),
      sol: localStorage.getItem(STORAGE_KEYS.SOLUTION),
      drills: localStorage.getItem(STORAGE_KEYS.DRILLS),
      lib: localStorage.getItem(STORAGE_KEYS.SAVED_PROBLEMS)
    };
    if (saved.text) setTextInput(saved.text);
    if (saved.ver) setVerificationResult(saved.ver);
    if (saved.sol) { setSolution(saved.sol); setLoadingState(LoadingState.SUCCESS); }
    if (saved.drills) setDrills(saved.drills);
    if (saved.lib) try { setSavedProblems(JSON.parse(saved.lib)); } catch(e) {}
  }, []);

  useEffect(() => localStorage.setItem(STORAGE_KEYS.TEXT_INPUT, textInput), [textInput]);
  useEffect(() => verificationResult ? localStorage.setItem(STORAGE_KEYS.VERIFICATION_RESULT, verificationResult) : localStorage.removeItem(STORAGE_KEYS.VERIFICATION_RESULT), [verificationResult]);
  useEffect(() => solution ? localStorage.setItem(STORAGE_KEYS.SOLUTION, solution) : localStorage.removeItem(STORAGE_KEYS.SOLUTION), [solution]);
  useEffect(() => drills ? localStorage.setItem(STORAGE_KEYS.DRILLS, drills) : localStorage.removeItem(STORAGE_KEYS.DRILLS), [drills]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.SAVED_PROBLEMS, JSON.stringify(savedProblems)), [savedProblems]);

  // Auto-enable learning mode when solution is ready, providing a better UX
  useEffect(() => {
    if (solution && loadingState === LoadingState.SUCCESS) {
      // Optional: setIsLearningMode(true); 
    }
  }, [solution, loadingState]);

  const stopAudio = () => {
    if (currentSourceRef.current) { try { currentSourceRef.current.stop(); } catch (e) {} currentSourceRef.current = null; }
    setIsPlayingAudio(false);
  };

  const handleToggleAudio = async () => {
    if (isPlayingAudio) { stopAudio(); return; }
    if (isGeneratingAudio) return;
    setIsGeneratingAudio(true);
    try {
      const base64 = await generateSpeech(solution);
      const bytes = decodeBase64(base64);
      if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const audioBuffer = await decodePcmAudio(bytes, audioContextRef.current);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => setIsPlayingAudio(false);
      stopAudio();
      currentSourceRef.current = source;
      source.start(0);
      setIsPlayingAudio(true);
    } catch (e) { alert("语音播报生成失败"); } finally { setIsGeneratingAudio(false); }
  };

  const handleVerify = async () => {
    if (!selectedImage && !textInput.trim()) return;
    setIsVerifying(true); setError(""); setVerificationResult(null); setSolution(""); setDrills("");
    try {
      const res = await verifyProblem({ 
        image: selectedImage ? { base64: selectedImage.base64, mimeType: selectedImage.file.type } : undefined, 
        text: textInput 
      });
      setVerificationResult(res);
    } catch (e: any) { setError("识别失败，请检查网络"); } finally { setIsVerifying(false); }
  };

  const handleSolve = async () => {
    setLoadingState(LoadingState.ANALYZING); setError(""); setSolution(""); setDrills("");
    try {
      const finalProblem = verificationResult || textInput;
      const res = await solveProblem({ text: finalProblem });
      setSolution(res); setLoadingState(LoadingState.SUCCESS);
      setIsLearningMode(true); // Automatically switch to focus mode
    } catch (e: any) { setError("解析生成失败"); setLoadingState(LoadingState.ERROR); }
  };

  const handleGenerateDrills = async () => {
    if (!solution) return;
    setIsGeneratingDrills(true);
    try {
      const res = await generateDrills(verificationResult || textInput, solution);
      setDrills(res);
    } catch (e: any) { alert("变式练习生成失败"); } finally { setIsGeneratingDrills(false); }
  };

  const handleSaveProblem = () => {
    const textToSnippet = (verificationResult || textInput || "新题目").slice(0, 30);
    const newProblem: SavedProblem = {
      id: Date.now().toString(),
      title: textToSnippet,
      questionText: verificationResult || textInput,
      solutionHtml: solution,
      tags: newProblemTags.split(/[,，]/).map(t => t.trim()).filter(t => t),
      isFavorite: false,
      timestamp: Date.now()
    };
    setSavedProblems([newProblem, ...savedProblems]);
    setIsSaveModalOpen(false);
    setNewProblemTags("");
  };

  const downloadAnalysis = () => {
    if (!analysisReportHtml) return;
    const styles = document.getElementById('app-styles')?.innerHTML || '';
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${styles}</style></head><body><div class="max-w-4xl mx-auto p-10">${analysisReportHtml}</div></body></html>`;
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Learning_Analysis_${Date.now()}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintAnalysis = () => {
    if (!analysisReportHtml) return;
    const styles = document.getElementById('app-styles')?.innerHTML || '';
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`<html><head><meta charset="UTF-8"><title>学情分析报告</title><script src="https://cdn.tailwindcss.com"></script><style>${styles} body { background: white !important; padding: 40px; } @media print { @page { size: A4; margin: 15mm; } body { padding: 0; } }</style></head><body><div class="max-w-4xl mx-auto">${analysisReportHtml}</div><script>window.onload = () => { setTimeout(() => { window.print(); }, 500); };</script></body></html>`);
    printWindow.document.close();
  };

  return (
    <div className="min-h-screen bg-[#F8FAFF] text-slate-800 font-sans transition-all duration-300">
      {/* Save Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold mb-4">收藏这道题</h3>
            <input 
              className="w-full px-4 py-3 rounded-xl border border-slate-200 mb-4 focus:border-indigo-500 outline-none" 
              placeholder="添加标签 (如: 时态, 动词拼写)"
              value={newProblemTags}
              onChange={e => setNewProblemTags(e.target.value)}
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => setIsSaveModalOpen(false)} className="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl">取消</button>
              <button onClick={handleSaveProblem} className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700">确认收藏</button>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Report Modal */}
      {analysisReportHtml && (
        <div className="fixed inset-0 z-[110] bg-slate-900/50 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-[32px] w-full max-w-4xl shadow-2xl relative animate-in slide-in-from-bottom-10 duration-500 my-8">
             <div className="sticky top-0 right-0 p-6 flex justify-end gap-3 z-10 bg-white/80 backdrop-blur rounded-t-[32px]">
                <button onClick={downloadAnalysis} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-full font-bold text-sm hover:bg-slate-200">
                  <Download size={16} /> 下载 HTML
                </button>
                <button onClick={handlePrintAnalysis} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-full font-bold text-sm hover:bg-indigo-700">
                  <Printer size={16} /> A4 打印报告
                </button>
                <button onClick={() => setAnalysisReportHtml(null)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                  <X size={24} />
                </button>
             </div>
             <div className="p-10 pt-0" dangerouslySetInnerHTML={{ __html: analysisReportHtml }} />
          </div>
        </div>
      )}

      <ProblemLibrary 
        isOpen={isLibraryOpen} 
        onClose={() => setIsLibraryOpen(false)} 
        savedProblems={savedProblems} 
        onLoadProblem={p => { setTextInput(p.questionText); setVerificationResult(p.questionText); setSolution(p.solutionHtml); setDrills(""); setLoadingState(LoadingState.SUCCESS); setIsLibraryOpen(false); setIsLearningMode(true); }}
        onDeleteProblem={id => setSavedProblems(savedProblems.filter(p => p.id !== id))}
        onToggleFavorite={id => setSavedProblems(savedProblems.map(p => p.id === id ? {...p, isFavorite: !p.isFavorite} : p))}
        onShowAnalysis={setAnalysisReportHtml}
      />

      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-slate-100 h-16 transition-all">
        <div className="max-w-6xl mx-auto px-4 h-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white"><GraduationCap size={18} /></div>
            <span className="font-extrabold text-lg tracking-tight hidden sm:inline">Gemini 智能英语私教</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
               <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={isLearningMode} onChange={(e) => setIsLearningMode(e.target.checked)} />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  <span className="ml-2 text-xs font-bold text-slate-600 select-none flex items-center gap-1">
                     <MonitorPlay size={12} /> 沉浸学习
                  </span>
               </label>
            </div>
            <div className="h-6 w-px bg-slate-200"></div>
            <button onClick={() => setIsLibraryOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all"><BookOpen size={18} /> <span className="hidden sm:inline">错题本</span></button>
            <button onClick={() => window.confirm("重置当前编辑内容?") && setSolution("")} className="p-2 text-slate-400 hover:text-red-500 rounded-full hover:bg-red-50 transition-all"><RotateCcw size={18} /></button>
          </div>
        </div>
      </header>

      <main className={`max-w-6xl mx-auto px-4 py-8 transition-all duration-500 ${isLearningMode && solution ? "block" : "grid lg:grid-cols-12 gap-10"}`}>
        {/* Left Column: Input (Hidden in Learning Mode if Solution exists) */}
        <div className={`${isLearningMode && solution ? "hidden" : "block lg:col-span-5"} space-y-8`}>
          <section className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
            <ImageUploader onImageSelected={setSelectedImage} onClear={() => setSelectedImage(null)} selectedImage={selectedImage} isLoading={isVerifying || loadingState === LoadingState.ANALYZING} />
            <textarea 
              className="w-full mt-4 p-4 rounded-2xl border border-slate-100 bg-slate-50 focus:bg-white focus:border-indigo-200 outline-none min-h-[100px] text-sm font-serif"
              placeholder="或在此粘贴文本题目..."
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
            />
            {!verificationResult && !solution && (
              <button 
                onClick={handleVerify} 
                disabled={isVerifying || (!selectedImage && !textInput)}
                className="w-full mt-4 py-4 bg-indigo-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all disabled:opacity-50"
              >
                {isVerifying ? <Loader2 className="animate-spin" size={20} /> : <Sparkles size={18} />}
                智能识别题目
              </button>
            )}
          </section>

          {verificationResult && !solution && (
            <section className="bg-amber-50 border-2 border-amber-200 rounded-3xl p-6 shadow-xl animate-in slide-in-from-top-6">
              <textarea 
                className="w-full p-5 rounded-2xl border-2 border-amber-100 bg-white text-slate-700 font-serif leading-relaxed outline-none focus:border-amber-400 min-h-[200px]"
                value={verificationResult}
                onChange={e => setVerificationResult(e.target.value)}
              />
              <button 
                onClick={handleSolve}
                className="w-full mt-5 py-4 bg-amber-500 text-white rounded-2xl font-extrabold hover:bg-amber-600 transition-all flex items-center justify-center gap-2"
              >
                开始深度解析 <ArrowRight size={20} />
              </button>
            </section>
          )}

          {solution && (
            <section className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4 animate-in fade-in slide-in-from-bottom-4">
               <h3 className="font-bold text-slate-800">学习操作</h3>
               {/* Note: The 'Generate Drills' button is now also inside the SolutionViewer Drills tab, but we keep a quick action here too if not in Learning Mode */}
               <button onClick={() => setIsSaveModalOpen(true)} className="w-full py-3 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-bold border border-indigo-100 hover:bg-indigo-100 flex items-center justify-center gap-2">
                 <CheckCircle size={16} /> 收藏到错题本
               </button>
               <button onClick={() => { setSolution(""); setDrills(""); setVerificationResult(null); setTextInput(""); }} className="w-full py-3 bg-slate-50 text-slate-600 rounded-xl text-sm font-bold border border-slate-100 hover:bg-slate-100">
                 开始下一题
               </button>
            </section>
          )}
        </div>

        {/* Right Column: Solution Viewer (Expands in Learning Mode) */}
        <div className={`${isLearningMode && solution ? "max-w-4xl mx-auto" : "lg:col-span-7"}`}>
          <SolutionViewer 
            solution={solution} 
            drills={drills}
            loadingState={loadingState} 
            error={error} 
            onToggleAudio={handleToggleAudio}
            isPlayingAudio={isPlayingAudio}
            isGeneratingAudio={isGeneratingAudio}
            onGenerateDrills={handleGenerateDrills}
            isGeneratingDrills={isGeneratingDrills}
          />
        </div>
      </main>

      <footer className="py-12 text-center text-slate-400 text-[10px] tracking-widest uppercase">
        © 2025 Gemini 智能英语私教 • 深度解析报告
      </footer>
    </div>
  );
};

export default App;