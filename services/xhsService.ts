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
    // TUNED FOR MAX QUALITY: q=100 (Max quality).
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
      lastError = err;
      // Progressive delay: wait longer after each failure
      await delay(1000 + (i * 500)); 
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

  try {
    // 2. Fetch HTML via Proxy Pool (Fallback Mechanism)
    // We try multiple proxies to ensure we get the HTML, prioritizing those that don't forward Mobile UA.
    
    const htmlProxies = [
      {
        name: 'AllOrigins',
        url: (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
        type: 'json' // Returns JSON with .contents
      },
      {
        name: 'CodeTabs',
        url: (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        type: 'text' // Returns raw HTML
      },
      {
        name: 'CorsProxy',
        url: (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
        type: 'text'
      }
    ];

    let html = '';
    let fetchError = null;

    for (const proxy of htmlProxies) {
      try {
        const proxyUrl = proxy.url(targetUrl);
        const response = await fetch(proxyUrl);
        
        if (!response.ok) {
          throw new Error(`Proxy ${proxy.name} returned status ${response.status}`);
        }

        if (proxy.type === 'json') {
          const data = await response.json();
          html = data.contents;
        } else {
          html = await response.text();
        }

        // Basic validation that we got something resembling HTML
        if (html && (html.includes('<html') || html.includes('<!DOCTYPE'))) {
          break; // Success, exit loop
        } else {
           throw new Error(`Proxy ${proxy.name} returned invalid content`);
        }
      } catch (e) {
        console.warn(`HTML Fetch failed via ${proxy.name}:`, e);
        fetchError = e;
        // Continue to next proxy
      }
    }

    if (!html) {
       throw fetchError || new Error("所有代理均无法获取页面数据，请稍后重试");
    }

    // 3. Extract __INITIAL_STATE__ JSON
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})(?=;?\s*<\/script>)/);

    if (!stateMatch) {
      throw new Error("无法解析帖子数据 (页面结构已变更或被拦截)");
    }

    const jsonStr = stateMatch[1].replace(/undefined/g, 'null');
    
    let state;
    try {
      state = JSON.parse(jsonStr);
    } catch (e) {
      console.error("JSON Parse Error", e);
      throw new Error("帖子数据解析异常");
    }

    // 4. Locate Note Data
    let note = state.note?.note;
    if (!note && state.note?.noteDetailMap) {
       const mapKeys = Object.keys(state.note.noteDetailMap);
       if (mapKeys.length > 0) {
         note = state.note.noteDetailMap[mapKeys[0]].note;
       }
    }

    if (!note) {
      throw new Error("未找到笔记详情数据");
    }

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

    return {
      id: note.noteId,
      title: note.title || note.desc?.slice(0, 50) || '无标题',
      author: note.user?.nickname || '匿名用户',
      authorAvatar: note.user?.avatar || '',
      images: images,
      timestamp: note.time || Date.now(),
    };

  } catch (error: any) {
    console.error("XHS Service Error:", error);
    const msg = error.message || "解析失败";
    if (msg.includes("Failed to fetch")) {
      throw new Error("网络请求被拦截，请尝试切换网络或稍后重试");
    }
    throw error;
  }
};

export const cleanXhsUrl = (url: string): string => {
  if (url.includes('!')) return url.split('!')[0];
  return url;
};