import React, { useState, useEffect } from 'react';
import { Search, Link as LinkIcon, X, Smartphone, MonitorSmartphone } from 'lucide-react';

interface SearchBarProps {
  onSearch: (url: string) => void;
  isLoading: boolean;
}

// 检测是否为移动设备
const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// 检查 Clipboard API 是否可用
const isClipboardAvailable = (): boolean => {
  return !!(navigator.clipboard && navigator.clipboard.readText);
};

export const SearchBar: React.FC<SearchBarProps> = ({ onSearch, isLoading }) => {
  const [url, setUrl] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [clipboardSupported, setClipboardSupported] = useState(true);
  const [showPasteError, setShowPasteError] = useState(false);

  useEffect(() => {
    // 检测设备类型和剪贴板支持
    setIsMobile(isMobileDevice());
    setClipboardSupported(isClipboardAvailable());
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onSearch(url.trim());
    }
  };

  const handlePaste = async () => {
    setShowPasteError(false);
    
    // 移动端友好提示
    if (isMobile) {
      // 在移动端,优先引导用户手动粘贴
      alert('请在输入框中长按并选择"粘贴"来粘贴链接 📱');
      return;
    }

    // PC端尝试使用 Clipboard API
    if (!clipboardSupported) {
      setShowPasteError(true);
      setTimeout(() => setShowPasteError(false), 3000);
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setUrl(text.trim());
        // 自动提交如果是链接
        if (text.includes('http')) {
          onSearch(text.trim());
        }
      } else {
        setShowPasteError(true);
        setTimeout(() => setShowPasteError(false), 3000);
      }
    } catch (err) {
      console.error('剪贴板访问被拒绝:', err);
      setShowPasteError(true);
      setTimeout(() => setShowPasteError(false), 3000);
    }
  };

  const clearInput = () => setUrl('');

  return (
    <div className="w-full max-w-xl mx-auto px-4 sticky top-16 z-30">
      <form 
        onSubmit={handleSubmit}
        className={`relative w-full overflow-hidden flex items-center bg-white rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 ${isLoading ? 'opacity-80' : ''}`}
      >
        <div className="pl-4 text-xhs-gray">
          <LinkIcon size={20} />
        </div>
        
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={isMobile ? "长按粘贴小红书链接..." : "粘贴小红书笔记链接..."}
          className="flex-1 min-w-0 py-4 px-3 bg-transparent border-none outline-none text-xhs-dark placeholder-gray-400 text-base"
          disabled={isLoading}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />

        {url && (
          <button 
            type="button"
            onClick={clearInput}
            className="p-2 text-gray-400 hover:text-xhs-dark transition-colors"
            aria-label="清空输入"
          >
            <X size={16} />
          </button>
        )}

        <button
          type="submit"
          disabled={isLoading || !url.trim()}
          className={`mr-1.5 py-2.5 px-4 md:px-6 rounded-full font-medium text-white transition-all transform active:scale-95 ${
            isLoading || !url.trim() 
              ? 'bg-gray-300 cursor-not-allowed' 
              : 'bg-xhs-red hover:bg-red-600 shadow-md'
          }`}
          aria-label="获取图片"
        >
          {isLoading ? '解析中' : '获取'}
        </button>
      </form>

      {/* Helper text/Quick Paste - 根据设备类型显示不同提示 */}
      {!url && !isLoading && (
        <div className="mt-3 text-center">
          {isMobile ? (
            <div className="text-xs text-gray-500 flex items-center justify-center gap-2">
              <Smartphone size={14} className="text-xhs-red" />
              <span>在输入框中长按并选择"粘贴"</span>
            </div>
          ) : clipboardSupported ? (
            <button 
              onClick={handlePaste}
              className="text-xs text-xhs-red font-medium bg-red-50 px-3 py-1 rounded-full hover:bg-red-100 active:bg-red-100 transition-colors"
              aria-label="快速粘贴"
            >
              📋 点击快速粘贴剪贴板链接
            </button>
          ) : (
            <div className="text-xs text-gray-400">
              请手动粘贴链接到输入框
            </div>
          )}
        </div>
      )}

      {/* 错误提示 */}
      {showPasteError && (
        <div className="mt-2 text-center text-xs text-red-500 animate-pulse">
          剪贴板访问失败,请手动粘贴链接
        </div>
      )}
    </div>
  );
};