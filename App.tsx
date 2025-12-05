import React, { useState, useEffect } from 'react';
import { SearchBar } from './components/SearchBar';
import { ImageCard } from './components/ImageCard';
import { parseXhsLink, fetchBlobWithRetry } from './services/xhsService';
import { generateSmartNames } from './services/geminiService';
import { XhsPost, XhsImage, ProcessingState } from './types';
import { Download, Sparkles, CheckSquare, Image as ImageIcon, Settings, X, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

// Use environment variable for API Key if available
const DEMO_API_KEY = process.env.API_KEY || ''; 

// Helper to determine extension from blob type
const getExtFromMime = (mime: string): string => {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/jpeg': 
    default: 
      return 'jpg';
  }
};

const App: React.FC = () => {
  const [post, setPost] = useState<XhsPost | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set()); // Track failed downloads
  const [processing, setProcessing] = useState<ProcessingState>({ status: 'idle' });
  const [apiKey, setApiKey] = useState(DEMO_API_KEY);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);

  // Check if Gemini is ready
  const isGeminiReady = !!apiKey;

  const handleSearch = async (url: string) => {
    setProcessing({ status: 'analyzing' });
    setPost(null);
    setSelectedIds(new Set());
    setFailedIds(new Set());

    try {
      const data = await parseXhsLink(url);
      setPost(data);
      // Select all by default
      setSelectedIds(new Set(data.images.map(img => img.id)));
      setProcessing({ status: 'idle' });
    } catch (error: any) {
      setProcessing({ status: 'error', message: error.message || '解析失败，请检查链接是否正确' });
      setTimeout(() => setProcessing({ status: 'idle' }), 3000);
    }
  };

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (!post) return;
    if (selectedIds.size === post.images.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(post.images.map(img => img.id)));
    }
  };

  const handleSmartRename = async () => {
    if (!post || !isGeminiReady) {
      if (!isGeminiReady) setShowApiKeyModal(true);
      return;
    }

    setProcessing({ status: 'renaming' });
    try {
      const updatedImages = await generateSmartNames(post.images, apiKey);
      setPost({ ...post, images: updatedImages });
      setProcessing({ status: 'idle' });
    } catch (error) {
      setProcessing({ status: 'error', message: 'AI 命名失败，请检查 API Key' });
      setTimeout(() => setProcessing({ status: 'idle' }), 3000);
    }
  };

  const handleDownload = async (retryFailedOnly = false) => {
    if (!post) return;
    
    const targetIds = retryFailedOnly ? failedIds : selectedIds;
    if (targetIds.size === 0) return;

    setProcessing({ status: 'downloading', progress: 0, total: targetIds.size });
    
    // Clear failed IDs if we are retrying them (we will re-add if they fail again)
    if (retryFailedOnly) {
        setFailedIds(new Set());
    } else {
        // If normal download, clear previous failures for selected items
        setFailedIds(prev => {
            const next = new Set(prev);
            targetIds.forEach(id => next.delete(id));
            return next;
        });
    }

    let successCount = 0;
    let failCount = 0;
    const imagesToDownload = post.images.filter(img => targetIds.has(img.id));

    // Sequential download
    for (const img of imagesToDownload) {
      try {
        let blob: Blob;
        
        // Strategy: Try HQ first, then Fallback
        try {
          blob = await fetchBlobWithRetry(img.url);
        } catch (hqError) {
          console.warn(`HQ download failed for ${img.id}, trying fallback...`);
          try {
             blob = await fetchBlobWithRetry(img.previewUrl);
          } catch (previewError) {
             throw previewError;
          }
        }
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Dynamic Extension based on real Mime Type
        const ext = getExtFromMime(blob.type);
        const fileName = img.aiName 
          ? `${img.aiName}.${ext}` 
          : `redsaver_${post.id}_${img.id}.${ext}`;
        
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        successCount++;
        setProcessing(prev => ({ ...prev, progress: successCount + failCount }));
        
      } catch (e) {
        console.error("Download failed for image", img.id, e);
        failCount++;
        setFailedIds(prev => new Set(prev).add(img.id));
        setProcessing(prev => ({ ...prev, progress: successCount + failCount }));
      }

      // Slower delay (1500ms) to reduce proxy rate limiting
      if (successCount + failCount < imagesToDownload.length) {
          await new Promise(r => setTimeout(r, 1500));
      }
    }

    if (failCount > 0) {
       setProcessing({ status: 'error', message: `完成: ${successCount} 张, 失败: ${failCount} 张` });
    } else {
       setProcessing({ status: 'success', message: '全部下载完成!' });
    }
    // Keep error message visible longer
    const timeout = failCount > 0 ? 5000 : 2500;
    setTimeout(() => {
        if (failCount === 0) setProcessing({ status: 'idle' });
        // If there are failures, we might want to keep the state distinguishable, but for now idle is fine as UI updates based on failedIds
        else setProcessing({ status: 'idle' }); 
    }, timeout);
  };

  // Calculate download progress percentage
  const downloadProgress = processing.total 
    ? Math.round(((processing.progress || 0) / processing.total) * 100) 
    : 0;

  return (
    <div className="min-h-screen pb-40">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-xhs-red rounded-xl flex items-center justify-center text-white font-bold text-lg">
              R
            </div>
            <h1 className="font-bold text-xl tracking-tight text-xhs-dark">RedSaver</h1>
          </div>
          <button 
            onClick={() => setShowApiKeyModal(true)}
            className="p-2 text-gray-400 hover:text-xhs-dark transition-colors"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      {/* Hero / Search Section */}
      <div className="bg-white pb-8 pt-6 rounded-b-[2rem] shadow-sm mb-6">
        <div className="max-w-2xl mx-auto text-center mb-6 px-4">
          <h2 className="text-2xl font-bold text-xhs-dark mb-2">一键提取无水印原图</h2>
          <p className="text-gray-500 text-sm">支持小红书帖子链接解析，Gemini AI 智能重命名</p>
        </div>
        <SearchBar onSearch={handleSearch} isLoading={processing.status === 'analyzing'} />
        
        {processing.status === 'error' && (
          <div className="text-center text-red-500 mt-4 text-sm font-medium animate-pulse">
            {processing.message}
          </div>
        )}
        {processing.status === 'success' && (
          <div className="text-center text-green-500 mt-4 text-sm font-medium">
            {processing.message}
          </div>
        )}
      </div>

      {/* Content Area */}
      <main className="max-w-3xl mx-auto px-4">
        {post && (
          <>
            {/* Post Info */}
            <div className="flex items-center gap-3 mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-50">
              <img 
                src={post.authorAvatar}
                alt="avatar" 
                className="w-10 h-10 rounded-full" 
                referrerPolicy="no-referrer"
              />
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-xhs-dark truncate">{post.title}</h3>
                <p className="text-xs text-gray-400">@{post.author}</p>
              </div>
              <div className="text-xs font-medium px-3 py-1 bg-gray-100 rounded-full text-gray-500">
                {post.images.length} 张图片
              </div>
            </div>

            {/* Grid - Changed from columns-* (masonry) to grid-* (standard grid) */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {post.images.map(img => (
                <ImageCard 
                  key={img.id} 
                  image={img} 
                  isSelected={selectedIds.has(img.id)}
                  onToggle={toggleSelection}
                  onPreview={(url) => {
                    setPreviewError(false);
                    setPreviewImage(url);
                  }}
                  // Pass failure state to card
                  hasError={failedIds.has(img.id)}
                />
              ))}
            </div>
          </>
        )}

        {!post && processing.status === 'idle' && (
          <div className="text-center py-20 text-gray-300">
            <ImageIcon size={48} className="mx-auto mb-4 opacity-50" />
            <p>粘贴链接开始下载</p>
          </div>
        )}
      </main>

      {/* Floating Action Bar */}
      {post && (
        <div className="fixed bottom-6 left-4 right-4 z-30">
          <div className="max-w-xl mx-auto bg-xhs-dark/90 backdrop-blur-lg text-white rounded-full shadow-2xl p-2 pl-6 flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm font-medium">
              <button onClick={toggleSelectAll} className="flex items-center gap-2 hover:text-gray-300 transition-colors">
                <CheckSquare size={18} className={selectedIds.size === post.images.length ? "text-xhs-red" : "text-gray-400"} />
                <span>全选 ({selectedIds.size})</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
               {/* Gemini Feature */}
               <button 
                onClick={handleSmartRename}
                disabled={processing.status !== 'idle'}
                className={`p-3 rounded-full transition-all ${
                  post.images.some(i => i.aiName) 
                    ? 'text-green-400 bg-white/10' 
                    : 'text-purple-300 hover:bg-white/10'
                }`}
                title="AI 智能命名"
              >
                {processing.status === 'renaming' ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Sparkles size={20} />
                )}
              </button>

              {/* Retry Button (Only appears if there are failures) */}
              {failedIds.size > 0 && processing.status === 'idle' && (
                  <button 
                    onClick={() => handleDownload(true)}
                    className="bg-red-500 hover:bg-red-600 text-white px-4 py-2.5 rounded-full font-bold transition-all active:scale-95 flex items-center gap-2 text-sm"
                  >
                    <RefreshCw size={16} />
                    <span>重试 ({failedIds.size})</span>
                  </button>
              )}

              {/* Main Download Button */}
              {!(failedIds.size > 0 && processing.status === 'idle') && (
                <button 
                  onClick={() => handleDownload(false)}
                  disabled={selectedIds.size === 0 || processing.status !== 'idle'}
                  className="relative overflow-hidden bg-xhs-red hover:bg-red-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-full font-bold transition-all active:scale-95 flex items-center gap-2"
                >
                  {processing.status === 'downloading' && (
                    <div 
                      className="absolute left-0 top-0 bottom-0 bg-black/20 transition-all duration-300 ease-out"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  )}
                  
                  <div className="relative z-10 flex items-center gap-2">
                    {processing.status === 'downloading' ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        <span className="tabular-nums text-sm">
                          {downloadProgress}% ({processing.progress}/{processing.total})
                        </span>
                      </>
                    ) : (
                      <>
                        <Download size={18} />
                        <span>下载</span>
                      </>
                    )}
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Full Screen Preview */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setPreviewImage(null)}
        >
          {previewError ? (
            <div className="text-white text-center">
              <AlertTriangle size={48} className="mx-auto mb-4 text-red-500" />
              <p className="font-medium">预览加载失败</p>
              <p className="text-xs text-gray-500 mt-2">（可能是防盗链限制，不影响下载）</p>
            </div>
          ) : (
            <img 
              src={previewImage}
              alt="preview" 
              className="max-w-full max-h-full rounded-md shadow-2xl object-contain" 
              referrerPolicy="no-referrer"
              onError={() => setPreviewError(true)}
            />
          )}
          
          <button className="absolute top-4 right-4 text-white/50 hover:text-white">
            <X size={32} />
          </button>
        </div>
      )}

      {/* Settings Modal (For API Key) */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-bounce-slow" style={{animation: 'none'}}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-xhs-dark">设置 Gemini API</h3>
              <button onClick={() => setShowApiKeyModal(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              要使用“AI 智能命名”功能，需要配置 Google Gemini API Key。
              <br/>
              <span className="text-xs opacity-70">注意：这是一个纯前端应用，Key 仅存储在内存中，刷新即失效。</span>
            </p>
            <input 
              type="password" 
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API Key"
              className="w-full bg-gray-100 rounded-lg px-4 py-3 mb-4 outline-none border border-transparent focus:border-xhs-red"
            />
            <button 
              onClick={() => setShowApiKeyModal(false)}
              className="w-full bg-xhs-dark text-white font-bold py-3 rounded-lg hover:opacity-90 transition-opacity"
            >
              保存
            </button>
            <div className="mt-4 text-center">
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline">
                获取免费 API Key &rarr;
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;