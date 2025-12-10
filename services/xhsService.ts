import { XhsPost, XhsImage } from '../types';

// Using a high-performance public CORS proxy to bypass browser restrictions for HTML fetching
export const CORS_PROXY = 'https://corsproxy.io/?';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to fetch image blob with retry logic using multiple proxies
export const fetchBlobWithRetry = async (url: string): Promise<Blob> => {
  const cacheBuster = Date.now();
  
  // Proxy Pool Strategy
  const proxies = [
    // 1. WSRV: Strongest image processing proxy. 
    // TUNED FOR MAX QUALITY: q=100 (Max quality), output=png (Lossless) or remove output to default to source.
    // We remove output enforcement to try and get original format if supported, or high quality fallback.
    // Actually, forcing 'jpg' at 100 is safe for compatibility, but let's try 'png' for lossless or just q=100.
    // Setting q=100 is the key.
    (u: string) => `https://wsrv.nl/?url=${encodeURIComponent(u)}&q=100&t=${cacheBuster}`,
    
    // 2. CodeTabs: Transparent proxy (Best for 1:1 original quality if it works)
    (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    
    // 3. AllOrigins: Raw proxy
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,

    // 4. CORS Proxy: Fallback
    (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    
    // 5. ThingProxy: Another fallback
    (u: string) => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(u)}`
  ];

  let lastError: any;

  for (let i = 0; i < proxies.length; i++) {
    const buildProxyUrl = proxies[i];
    try {
      const proxyUrl = buildProxyUrl(url);
      // console.log(`Attempting proxy ${i + 1}/${proxies.length}: ${proxyUrl.substring(0, 50)}...`);
      
      const response = await fetch(proxyUrl, {
        cache: 'no-store',
        credentials: 'omit'
      });
      
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }

      // STRICT VALIDATION: Check Content-Type
      const contentType = response.headers.get('content-type');
      if (contentType && (contentType.includes('text/html') || contentType.includes('application/json'))) {
        throw new Error(`Invalid content-type: ${contentType} (Likely an error page)`);
      }

      const blob = await response.blob();

      // STRICT VALIDATION: Check Size
      // Increased to 5KB (5120 bytes) to filter out 403 placeholders or empty files
      if (blob.size < 5120) {
        throw new Error(`File too small (${blob.size} bytes). Likely a corruption or error placeholder.`);
      }

      return blob; // Success!
    } catch (err) {
      // console.warn(`Proxy ${i + 1} failed for ${url.substring(0, 30)}...`, err);
      lastError = err;
      // 优化延迟: 减少等待时间以加快下载速度
      // 第一次失败等300ms，后续每次增加200ms
      if (i < proxies.length - 1) {
        await delay(300 + (i * 200)); 
      }
    }
  }

  throw lastError || new Error("All proxies failed to download image");
};

export const parseXhsLink = async (text: string): Promise<XhsPost> => {
  // 1. Extract URL from mixed text
  const urlMatch = text.match(/https?:\/\/(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+/);
  const targetUrl = urlMatch ? urlMatch[0] : text;

  if (!targetUrl.includes('xiaohongshu.com') && !targetUrl.includes('xhslink.com')) {
    throw new Error("未检测到有效的小红书链接");
  }

  // 记录设备信息 (用于调试)
  const deviceInfo = {
    userAgent: navigator.userAgent,
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    timestamp: new Date().toISOString()
  };
  console.log('[XHS Service] 开始解析链接:', { targetUrl, deviceInfo });

  try {
    // 2. Fetch HTML via Proxy
    const proxyUrl = `${CORS_PROXY}${encodeURIComponent(targetUrl)}`;
    console.log('[XHS Service] 使用代理:', proxyUrl.substring(0, 80) + '...');
    
    // 重要: 使用桌面版 User-Agent,确保获取到统一的页面结构
    // 移动端浏览器访问时,如果发送移动端 UA,小红书可能返回不同的HTML结构
    const desktopUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
    
    const response = await fetch(proxyUrl, {
      headers: {
        'User-Agent': desktopUserAgent,
      },
      cache: 'no-store',
      credentials: 'omit'
    });

    if (!response.ok) {
      const errorMsg = `网络请求失败: ${response.status} ${response.statusText}`;
      console.error('[XHS Service] 请求失败:', errorMsg);
      throw new Error(errorMsg);
    }

    const html = await response.text();
    console.log('[XHS Service] HTML 长度:', html.length);

    // 3. Extract __INITIAL_STATE__ JSON
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})(?=;?\s*<\/script>)/);

    if (!stateMatch) {
      console.error('[XHS Service] 无法提取 __INITIAL_STATE__');
      console.log('[XHS Service] HTML 前500字符:', html.substring(0, 500));
      throw new Error("无法解析帖子数据 (页面结构已变更或被拦截)");
    }

    const jsonStr = stateMatch[1].replace(/undefined/g, 'null');
    
    let state;
    try {
      state = JSON.parse(jsonStr);
      console.log('[XHS Service] 成功解析 JSON');
      // 输出完整的 State 结构用于调试
      console.log('[XHS Service] 完整 State 结构:', JSON.stringify(state, null, 2));
      console.log('[XHS Service] State 顶层 keys:', Object.keys(state));
    } catch (e) {
      console.error("[XHS Service] JSON 解析错误:", e);
      console.log('[XHS Service] JSON 前500字符:', jsonStr.substring(0, 500));
      throw new Error("帖子数据解析异常");
    }

    // 4. Locate Note Data - 尝试多种可能的路径
    console.log('[XHS Service] 尝试定位笔记数据...');
    let note = null;
    
    // 策略 1: state.note.note (PC端最常见)
    if (state.note?.note) {
      note = state.note.note;
      console.log('[XHS Service] ✓ 通过 state.note.note 找到数据 (PC端结构)');
    }
    
    // 策略 2: state.note.noteDetailMap (PC端备用方案)
    if (!note && state.note?.noteDetailMap) {
       const mapKeys = Object.keys(state.note.noteDetailMap);
       console.log('[XHS Service] noteDetailMap keys:', mapKeys);
       if (mapKeys.length > 0) {
         note = state.note.noteDetailMap[mapKeys[0]].note;
         console.log('[XHS Service] ✓ 通过 noteDetailMap 找到数据 (PC端结构)');
       }
    }
    
    // 策略 3: state.noteData.data.noteData (移动端结构) ⭐ 重要!
    if (!note && state.noteData?.data?.noteData) {
      note = state.noteData.data.noteData;
      console.log('[XHS Service] ✓ 通过 state.noteData.data.noteData 找到数据 (移动端结构)');
    }
    
    // 策略 4: state.note.noteDetail
    if (!note && state.note?.noteDetail) {
      note = state.note.noteDetail;
      console.log('[XHS Service] ✓ 通过 state.note.noteDetail 找到数据');
    }
    
    // 策略 5: 直接在 state.note 中
    if (!note && state.note && !state.note.note && !state.note.noteDetailMap) {
      console.log('[XHS Service] state.note 的 keys:', Object.keys(state.note));
      // 可能整个 state.note 就是 note
      if (state.note.noteId || state.note.imageList) {
        note = state.note;
        console.log('[XHS Service] ✓ state.note 本身就是笔记数据');
      }
    }

    if (!note) {
      console.error('[XHS Service] ❌ 未找到笔记数据');
      console.log('[XHS Service] state.note 结构:', state.note ? JSON.stringify(state.note, null, 2).substring(0, 1000) : 'undefined');
      console.log('[XHS Service] state.noteData 结构:', state.noteData ? JSON.stringify(state.noteData, null, 2).substring(0, 1000) : 'undefined');
      throw new Error("未找到笔记详情数据");
    }

    console.log('[XHS Service] 找到笔记:', { 
      noteId: note.noteId, 
      imageCount: note.imageList?.length || 0 
    });

    // 5. Process Images
    const imageList = note.imageList || [];
    const images: XhsImage[] = imageList.map((img: any, index: number) => {
      let originalUrl = img.urlDefault || img.url || '';
      
      // Standardize HTTPS
      if (originalUrl.startsWith('http://')) {
        originalUrl = originalUrl.replace('http://', 'https://');
      }

      // Clean URL logic:
      // We ONLY strip the '!' parameters which are used for image processing (resize/watermark).
      // We MUST PRESERVE the '?' parameters as they often contain authentication tokens.
      let cleanUrl = originalUrl;
      if (cleanUrl.includes('!')) {
        cleanUrl = cleanUrl.split('!')[0];
      }

      return {
        id: img.fileId || `img_${index}_${Date.now()}`,
        url: cleanUrl, // High quality, token preserved
        previewUrl: originalUrl, // Original
        width: img.width || 1080,
        height: img.height || 1440,
        aiName: undefined
      };
    });

    console.log('[XHS Service] ✅ 解析成功,共', images.length, '张图片');

    return {
      id: note.noteId,
      title: note.title || note.desc?.slice(0, 50) || '无标题',
      author: note.user?.nickname || '匿名用户',
      authorAvatar: note.user?.avatar || '',
      images: images,
      timestamp: note.time || Date.now(),
    };

  } catch (error: any) {
    console.error("[XHS Service] ❌ 解析失败:", error);
    console.error("[XHS Service] 错误堆栈:", error.stack);
    
    const msg = error.message || "解析失败";
    
    // 提供更友好的错误提示
    if (msg.includes("Failed to fetch")) {
      throw new Error("网络连接失败,请检查网络后重试");
    }
    if (msg.includes("NetworkError")) {
      throw new Error("网络请求被阻止,可能是跨域限制");
    }
    if (msg.includes("timeout")) {
      throw new Error("请求超时,请稍后重试");
    }
    
    throw error;
  }
};

export const cleanXhsUrl = (url: string): string => {
  if (url.includes('!')) return url.split('!')[0];
  return url;
};