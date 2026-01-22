import React, { useState, useMemo } from 'react';
import { SavedProblem } from '../types';
import { Search, Star, Tag, Trash2, X, Filter, BookOpen, Calendar, ChevronRight, Printer, FileText, BarChart3, Loader2 } from 'lucide-react';
import { analyzeProblemHistory } from '../services/geminiService';

interface ProblemLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  savedProblems: SavedProblem[];
  onLoadProblem: (problem: SavedProblem) => void;
  onDeleteProblem: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onShowAnalysis: (html: string) => void;
}

const ProblemLibrary: React.FC<ProblemLibraryProps> = ({
  isOpen,
  onClose,
  savedProblems,
  onLoadProblem,
  onDeleteProblem,
  onToggleFavorite,
  onShowAnalysis,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    savedProblems.forEach(p => p.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [savedProblems]);

  const filteredProblems = useMemo(() => {
    return savedProblems.filter(p => {
      const matchesSearch = p.questionText.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            p.title.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesTag = selectedTag ? p.tags.includes(selectedTag) : true;
      const matchesFav = showFavoritesOnly ? p.isFavorite : true;
      return matchesSearch && matchesTag && matchesFav;
    }).sort((a, b) => b.timestamp - a.timestamp);
  }, [savedProblems, searchTerm, selectedTag, showFavoritesOnly]);

  const handleRunAnalysis = async () => {
    if (savedProblems.length < 2) {
      alert("错题库题目太少，至少需要 2 道题才能生成学情分析。");
      return;
    }
    setIsAnalyzing(true);
    try {
      const html = await analyzeProblemHistory(savedProblems);
      onShowAnalysis(html);
    } catch (e) {
      alert("学情分析生成失败，请检查网络。");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExportPracticeSheet = () => {
    if (filteredProblems.length === 0) {
      alert("当前列表没有题目，无法导出。");
      return;
    }

    const now = new Date();
    const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    
    const chunks = [];
    for (let i = 0; i < filteredProblems.length; i += 5) {
      chunks.push(filteredProblems.slice(i, i + 5));
    }

    const styles = `
      @page { size: A4; margin: 20mm; }
      body { font-family: "SimSun", serif; margin: 0; padding: 0; }
      .page { width: 100%; height: 255mm; page-break-after: always; display: flex; flex-direction: column; }
      .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
      .problem-item { border-bottom: 1px dashed #ccc; padding: 15px 0; }
      .problem-text { font-size: 16px; font-weight: bold; }
    `;

    const pagesHtml = chunks.map((chunk, pageIndex) => `
      <div class="page">
        <div class="header">
          <h1>错题集锦练习纸</h1>
          <p>生成日期：${dateStr} | 第 ${pageIndex + 1} 页</p>
        </div>
        <div class="problem-list">
          ${chunk.map((p, idx) => `
            <div class="problem-item">
              <div>题目 ${pageIndex * 5 + idx + 1} [${p.tags.join(', ')}]</div>
              <div class="problem-text">${p.questionText}</div>
              <div style="height: 100px;"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    const htmlContent = `<html><head><style>${styles}</style></head><body>${pagesHtml}<script>window.print();</script></body></html>`;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-white">
          <div className="flex items-center gap-3">
             <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
                <BookOpen size={24} />
             </div>
             <div>
                <h2 className="text-xl font-bold text-slate-800">错题本 / 题库</h2>
                <p className="text-sm text-slate-500">共 {savedProblems.length} 道题目</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        <div className="p-5 border-b border-slate-100 space-y-4">
          <div className="relative">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
             <input 
                type="text" 
                placeholder="搜索题目内容..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-400 text-sm"
             />
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handleRunAnalysis} disabled={isAnalyzing || savedProblems.length < 2} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">
               {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
               生成学情分析
            </button>
            <button onClick={handleExportPracticeSheet} disabled={filteredProblems.length === 0} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-700 disabled:opacity-50">
                <Printer size={14} />
                导出练习纸
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/50">
           {filteredProblems.length === 0 ? (
              <div className="text-center py-20 text-slate-400">
                 <Filter size={24} className="mx-auto mb-2" />
                 <p>没有找到符合条件的题目</p>
              </div>
           ) : (
              filteredProblems.map(problem => (
                 <div key={problem.id} className="group bg-white rounded-xl p-4 border border-slate-200 shadow-sm hover:shadow-md transition-all relative">
                    <div className="flex justify-between items-start mb-2">
                       <div className="flex-1 pr-8">
                          <h3 className="font-bold text-slate-800 line-clamp-1">{problem.title || "未命名题目"}</h3>
                          <p className="text-xs text-slate-500 line-clamp-2 mt-1 bg-slate-50 p-2 rounded">{problem.questionText}</p>
                       </div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                       <div className="flex items-center gap-2">
                          {problem.tags.map(tag => (
                             <span key={tag} className="px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-100">
                                {tag}
                             </span>
                          ))}
                       </div>
                       <div className="flex items-center gap-2">
                          <button onClick={() => onToggleFavorite(problem.id)} className="p-1.5 rounded-lg hover:bg-yellow-50 transition-colors">
                             <Star size={16} className={problem.isFavorite ? "fill-yellow-400 text-yellow-400" : "text-slate-300"} />
                          </button>
                          <button onClick={() => { if(confirm('确定删除?')) onDeleteProblem(problem.id); }} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500">
                             <Trash2 size={16} />
                          </button>
                          <button onClick={() => onLoadProblem(problem)} className="px-3 py-1.5 bg-indigo-50 text-indigo-600 text-xs font-bold rounded-lg hover:bg-indigo-100">
                             查看解析
                          </button>
                       </div>
                    </div>
                 </div>
              ))
           )}
        </div>
      </div>
    </div>
  );
};

export default ProblemLibrary;