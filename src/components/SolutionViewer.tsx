import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, AlertCircle, GraduationCap, Loader2, ShieldAlert, WifiOff, Settings, Printer, Volume2, Pause, Download, FileText, Dumbbell, Sparkles, FileCheck, FileQuestion } from 'lucide-react';
import { LoadingState } from '../types';

interface SolutionViewerProps {
  solution: string;
  drills?: string;
  loadingState: LoadingState;
  error?: string;
  onToggleAudio?: () => void;
  isPlayingAudio?: boolean;
  isGeneratingAudio?: boolean;
  onGenerateDrills?: () => void;
  isGeneratingDrills?: boolean;
}

const SolutionViewer: React.FC<SolutionViewerProps> = ({ 
  solution, 
  drills,
  loadingState, 
  error,
  onToggleAudio,
  isPlayingAudio,
  isGeneratingAudio,
  onGenerateDrills,
  isGeneratingDrills
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const drillsRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<'analysis' | 'drills'>('analysis');

  useEffect(() => {
    // MathJax formatting
    if ((loadingState === LoadingState.SUCCESS || solution) && (window as any).MathJax) {
      const mathJax = (window as any).MathJax;
      const timeoutId = setTimeout(() => {
        const nodesToProcess = [];
        if (activeTab === 'analysis' && containerRef.current) nodesToProcess.push(containerRef.current);
        if (activeTab === 'drills' && drillsRef.current) nodesToProcess.push(drillsRef.current);

        if (nodesToProcess.length > 0) {
           if (mathJax.typesetPromise) {
             mathJax.typesetPromise(nodesToProcess).catch((err: any) => console.error('MathJax error:', err));
           } else if (mathJax.typeset) {
             mathJax.typeset(nodesToProcess);
           }
        }
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [solution, drills, loadingState, activeTab]);

  // Switch to drills tab automatically when drills are generated
  useEffect(() => {
    if (drills) {
      setActiveTab('drills');
    }
  }, [drills]);

  const handlePrintPDF = (mode: 'full' | 'student' | 'key' = 'full') => {
    if (activeTab === 'analysis' && !solution) return;
    if (activeTab === 'drills' && !drills) return;

    const styles = document.getElementById('app-styles')?.innerHTML || '';
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert("请允许弹出窗口以进行打印"); return; }

    let content = '';
    let bodyClass = '';
    let title = 'Gemini 英语私教';

    if (activeTab === 'drills' && drills) {
      content = `<div class="drills-content"><h1 class="text-2xl font-bold mb-4 border-b pb-2">变式巩固训练</h1>${drills}</div>`;
      if (mode === 'student') {
        bodyClass = 'print-mode-student';
        title = '变式训练 (学生版)';
      } else if (mode === 'key') {
        // CRITICAL FIX: Force all details elements to be OPEN by default when printing the key
        // This ensures the browser renders the content inside even if CSS display:block is used.
        content = content.replace(/<details/g, '<details open');
        bodyClass = 'print-mode-key';
        title = '变式训练 (答案版)';
      }
    } else {
      content = solution;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>${title}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>${styles} 
            body { background: white !important; padding: 20px; } 
            .solution-card { box-shadow: none !important; border: none !important; padding: 0 !important; position: relative; width: 100%; }
          </style>
        </head>
        <body class="${bodyClass}"><div class="max-w-4xl mx-auto"><div class="solution-card">${content}</div></div><script>window.onload=()=>{window.print();};</script></body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownloadHTML = () => {
    if (!solution) return;
    const styles = document.getElementById('app-styles')?.innerHTML || '';
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${styles}</style></head><body><div class="max-w-4xl mx-auto p-8"><div class="solution-card">${solution}<hr class="my-8"/>${drills || ''}</div></div></body></html>`;
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `English_Report_${Date.now()}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getErrorDetails = (err: string = "") => {
    const lowerErr = err.toLowerCase();
    if (lowerErr.includes("safety")) return { icon: <ShieldAlert className="text-amber-500" />, title: "内容无法显示", message: "由于安全策略，该题目的解析无法生成。", suggestion: "尝试重新拍摄题目文字部分。", bgColor: "bg-amber-50", borderColor: "border-amber-200", textColor: "text-amber-900" };
    if (lowerErr.includes("api_key")) return { icon: <Settings className="text-red-500" />, title: "配置错误", message: "API 密钥配置有误。", suggestion: "请联系管理员检查设置。", bgColor: "bg-red-50", borderColor: "border-red-200", textColor: "text-red-900" };
    return { icon: <AlertCircle className="text-red-500" />, title: "解析失败", message: "解析过程中出现未知错误。", suggestion: "请刷新页面重试。", bgColor: "bg-red-50", borderColor: "border-red-200", textColor: "text-red-900" };
  };

  if (loadingState === LoadingState.IDLE) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 min-h-[400px]">
        <div className="bg-indigo-50 p-6 rounded-full mb-4">
            <BookOpen size={48} strokeWidth={1} className="opacity-50 text-indigo-400" />
        </div>
        <p className="text-center font-medium text-lg text-slate-500">上传英语错题</p>
        <p className="text-center text-sm mt-2 max-w-xs">AI 英语私教将为你提供深度的语法诊断、翻译和考点分析。</p>
      </div>
    );
  }

  if (loadingState === LoadingState.ERROR) {
    const details = getErrorDetails(error);
    return (
      <div className={`p-8 rounded-2xl border-2 ${details.bgColor} ${details.borderColor} flex flex-col items-center text-center gap-4 animate-in fade-in zoom-in-95 duration-200`}>
        <div className="p-4 bg-white rounded-full shadow-sm">{React.cloneElement(details.icon as any, { size: 32 })}</div>
        <div className={details.textColor}>
          <h3 className="text-xl font-bold mb-2">{details.title}</h3>
          <p className="text-sm opacity-80 mb-4 max-w-md mx-auto">{details.message}</p>
          <div className="bg-white/50 py-2 px-4 rounded-lg inline-block text-xs font-semibold">💡 建议：{details.suggestion}</div>
        </div>
      </div>
    );
  }

  if (loadingState === LoadingState.SOLVING || loadingState === LoadingState.ANALYZING) {
     return (
        <div className="h-full flex flex-col items-center justify-center p-12 min-h-[400px]">
           <div className="relative">
              <Loader2 className="w-16 h-16 text-indigo-500 animate-spin" />
              <GraduationCap className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-500 w-7 h-7 animate-pulse" />
           </div>
           <h3 className="mt-6 text-lg font-semibold text-slate-700">英语名师正在解析中...</h3>
           <p className="text-sm text-slate-400 mt-2">正在分析语法、拆解长难句...</p>
        </div>
     )
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Tab Navigation */}
      <div className="bg-white rounded-xl p-1.5 flex shadow-sm border border-slate-100 self-start print:hidden">
        <button 
          onClick={() => setActiveTab('analysis')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'analysis' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <Sparkles size={16} /> 深度解析
        </button>
        <button 
          onClick={() => setActiveTab('drills')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'drills' ? 'bg-violet-50 text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {isGeneratingDrills ? <Loader2 size={16} className="animate-spin" /> : <Dumbbell size={16} />} 
          变式训练
        </button>
      </div>

      <div className="bg-transparent relative group flex-1">
        {/* Content Area */}
        <div className="min-h-full">
           <div style={{ display: activeTab === 'analysis' ? 'block' : 'none' }}>
              <div ref={containerRef} className="solution-card" dangerouslySetInnerHTML={{ __html: solution }} />
           </div>
           
           <div style={{ display: activeTab === 'drills' ? 'block' : 'none' }}>
              {drills ? (
                 <div ref={drillsRef} className="solution-card drills-card animate-in slide-in-from-right-4 duration-300">
                    <div className="flex items-center justify-between mb-6 pb-4 border-b border-violet-100">
                       <div className="flex items-center gap-2">
                          <div className="bg-violet-100 p-2 rounded-lg text-violet-600"><Dumbbell size={20} /></div>
                          <h2 className="text-xl font-bold text-slate-800">巩固练习</h2>
                       </div>
                    </div>
                    <div className="drills-content text-slate-700 leading-loose" dangerouslySetInnerHTML={{ __html: drills }} />
                 </div>
              ) : (
                 <div className="bg-white rounded-3xl p-10 shadow-sm border border-slate-100 text-center flex flex-col items-center justify-center h-[400px]">
                    <div className="bg-violet-50 p-4 rounded-full mb-4">
                       <Dumbbell size={32} className="text-violet-400" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-700 mb-2">暂无变式题</h3>
                    <p className="text-slate-400 text-sm mb-6 max-w-xs">基于当前题目的考点，生成 6 道相似题目进行巩固练习，支持一键打印试卷。</p>
                    <button 
                       onClick={onGenerateDrills}
                       disabled={isGeneratingDrills}
                       className="px-6 py-3 bg-violet-600 text-white rounded-xl font-bold shadow-lg shadow-violet-200 hover:bg-violet-700 hover:shadow-xl transition-all flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                       {isGeneratingDrills ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                       生成 6 道变式题
                    </button>
                 </div>
              )}
           </div>
        </div>
        
        {/* Floating Toolbar */}
        <div className="absolute top-6 right-6 flex flex-wrap justify-end gap-2 print:hidden transition-all opacity-0 group-hover:opacity-100 z-20">
          
          {/* Analysis Tab Buttons */}
          {activeTab === 'analysis' && (
            <>
              {onToggleAudio && (
                <button 
                  onClick={onToggleAudio}
                  disabled={isGeneratingAudio}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm border transition-all ${
                    isPlayingAudio 
                      ? 'bg-red-500 text-white border-red-600' 
                      : 'bg-white/90 backdrop-blur hover:bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  {isGeneratingAudio ? <Loader2 size={16} className="animate-spin" /> : (isPlayingAudio ? <Pause size={16} /> : <Volume2 size={16} />)}
                  {isGeneratingAudio ? "生成中" : (isPlayingAudio ? "停止" : "真人讲题")}
                </button>
              )}
              <button onClick={handleDownloadHTML} className="flex items-center gap-2 px-3 py-1.5 bg-white/90 backdrop-blur hover:bg-slate-50 text-slate-600 rounded-lg shadow-sm border border-slate-200 text-xs font-bold transition-all"><FileText size={16} /> HTML</button>
              <button onClick={() => handlePrintPDF('full')} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm text-xs font-bold transition-all"><Printer size={16} /> 打印</button>
            </>
          )}

          {/* Drills Tab Buttons - Enhanced Print Options */}
          {activeTab === 'drills' && drills && (
            <>
               <button onClick={() => handlePrintPDF('student')} className="flex items-center gap-2 px-3 py-1.5 bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50 rounded-lg shadow-sm text-xs font-bold transition-all">
                  <FileQuestion size={16} /> 打印试卷 (学生)
               </button>
               <button onClick={() => handlePrintPDF('key')} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm text-xs font-bold transition-all">
                  <FileCheck size={16} /> 打印答案 (老师)
               </button>
            </>
          )}
          
        </div>
      </div>
    </div>
  );
};

export default SolutionViewer;