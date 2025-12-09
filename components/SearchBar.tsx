import React, { useState, useEffect } from 'react';
import { Search, Link as LinkIcon, X } from 'lucide-react';

interface SearchBarProps {
  onSearch: (url: string) => void;
  isLoading: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSearch, isLoading }) => {
  const [url, setUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onSearch(url.trim());
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      // Auto submit if it looks like a link
      if (text.includes('http')) {
        onSearch(text);
      }
    } catch (err) {
      console.error('Clipboard access denied', err);
    }
  };

  const clearInput = () => setUrl('');

  return (
    <div className="w-full max-w-xl mx-auto px-4 sticky top-16 z-30">
      <form 
        onSubmit={handleSubmit}
        className={`relative flex items-center bg-white rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 ${isLoading ? 'opacity-80' : ''}`}
      >
        <div className="pl-4 text-xhs-gray">
          <LinkIcon size={20} />
        </div>
        
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴小红书笔记链接..."
          className="flex-1 min-w-0 py-4 px-3 bg-transparent border-none outline-none text-xhs-dark placeholder-gray-400 text-base"
          disabled={isLoading}
        />

        {url && (
          <button 
            type="button"
            onClick={clearInput}
            className="p-2 text-gray-400 hover:text-xhs-dark transition-colors"
          >
            <X size={16} />
          </button>
        )}

        <button
          type="submit"
          disabled={isLoading || !url.trim()}
          className={`mr-1.5 py-2.5 px-6 rounded-full font-medium text-white transition-all transform active:scale-95 ${
            isLoading || !url.trim() 
              ? 'bg-gray-300 cursor-not-allowed' 
              : 'bg-xhs-red hover:bg-red-600 shadow-md'
          }`}
        >
          {isLoading ? '解析中' : '获取'}
        </button>
      </form>

      {/* Helper text/Quick Paste */}
      {!url && !isLoading && (
        <div className="mt-3 text-center">
           <button 
            onClick={handlePaste}
            className="text-xs text-xhs-red font-medium bg-red-50 px-3 py-1 rounded-full active:bg-red-100"
           >
             📋 点击粘贴剪贴板链接
           </button>
        </div>
      )}
    </div>
  );
};