
import React, { useCallback, useState, useEffect } from 'react';
import { Upload, X, Languages, Loader2 } from 'lucide-react';
import { UploadedImage } from '../types';

interface ImageUploaderProps {
  onImageSelected: (image: UploadedImage) => void;
  onClear: () => void;
  selectedImage: UploadedImage | null;
  isLoading: boolean;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageSelected, onClear, selectedImage, isLoading }) => {
  const [isDragging, setIsDragging] = useState(false);

  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('请上传图片文件');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      onImageSelected({
        file,
        previewUrl: URL.createObjectURL(file),
        base64: result
      });
    };
    reader.readAsDataURL(file);
  }, [onImageSelected]);

  // Handle paste events globally
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (isLoading) return; // Disable paste while loading
      
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            processFile(blob);
            e.preventDefault(); // Prevent default paste behavior
          }
          break; // Process only the first image found
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [processFile, isLoading]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  }, [processFile]);

  if (selectedImage) {
    return (
      <div className="relative group rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-white">
        <img 
          src={selectedImage.previewUrl} 
          alt="English problem" 
          className="w-full h-auto max-h-[400px] object-contain mx-auto"
        />
        {!isLoading && (
          <button
            onClick={onClear}
            className="absolute top-3 right-3 p-2 bg-white/90 backdrop-blur-sm text-slate-600 rounded-full shadow-md hover:bg-red-50 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
            title="移除图片"
          >
            <X size={20} />
          </button>
        )}
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-[2px] flex items-center justify-center">
             <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 text-violet-600 animate-spin" />
                <p className="text-sm font-medium text-slate-700 bg-white/80 px-4 py-1.5 rounded-full shadow-sm">正在分析语法...</p>
             </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`
        relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all duration-300 ease-in-out cursor-pointer group
        ${isDragging 
          ? 'border-violet-500 bg-violet-50/50 scale-[1.01]' 
          : 'border-slate-300 hover:border-violet-400 hover:bg-slate-50'
        }
      `}
    >
      <input
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
      
      <div className="flex flex-col items-center gap-4 pointer-events-none">
        <div className={`p-4 rounded-full transition-colors ${isDragging ? 'bg-violet-100 text-violet-600' : 'bg-slate-100 text-slate-500 group-hover:bg-violet-50 group-hover:text-violet-500'}`}>
          <Upload size={32} strokeWidth={1.5} />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-medium text-slate-700">
            点击上传、拖拽或 <span className="text-violet-600 bg-violet-50 px-1 rounded">Ctrl+V</span> 粘贴
          </p>
          <p className="text-sm text-slate-500">
            支持英语练习题、试卷照片 (JPG, PNG)
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-400 uppercase tracking-wider mt-2">
          <Languages size={14} />
          <span>English Grammar Solver</span>
        </div>
      </div>
    </div>
  );
};

export default ImageUploader;
