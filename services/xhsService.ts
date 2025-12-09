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

  // Proxy Pool for HTML
  const htmlProxies = [
    (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u: string) => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(u)}`
  ];

  let lastError: any;
  let html = '';

  // 2. Fetch HTML via Proxy Rotation
  for (let i = 0; i < htmlProxies.length; i++) {
    try {
      const proxyUrl = htmlProxies[i](targetUrl);
      const response = await fetch(proxyUrl);
      
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }

      const text = await response.text();
      // Basic validation to ensure we got some HTML
      if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
        html = text;
        break;
      } else {
        throw new Error("Invalid HTML content");
      }
    } catch (err) {
      console.warn(`HTML Proxy ${i + 1} failed`, err);
      lastError = err;
      await delay(500);
    }
  }

  if (!html) {
    throw lastError || new Error("无法获取笔记页面内容 (所有代理均失败)");
  }

  // 3. Extract State JSON
  // Try __INITIAL_STATE__ first, then __INITIAL_SSR_STATE__
  let stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})(?=;?\s*<\/script>)/);
  if (!stateMatch) {
     stateMatch = html.match(/window\.__INITIAL_SSR_STATE__\s*=\s*({[\s\S]*?})(?=;?\s*<\/script>)/);
  }

  if (!stateMatch) {
    // Fallback: Try to find JSON in a script tag with id="initial-state" (sometimes used)
    const scriptMatch = html.match(/<script id="initial-state" type="application\/json">([\s\S]*?)<\/script>/);
    if (scriptMatch) {
        stateMatch = scriptMatch; // Reuse variable
    } else {
        throw new Error("无法解析帖子数据 (页面结构已变更或被拦截)");
    }
  }

  const jsonStr = stateMatch[1].replace(/undefined/g, 'null');
  
  let state;
  try {
    state = JSON.parse(jsonStr);
  } catch (e) {
    console.error("JSON Parse Error", e);
    throw new Error("帖子数据解析异常");
  }

  // 4. Locate Note Data (Robust Path Finding)
  let note = state.note?.note || state.note; // Sometimes it's directly in state.note
  
  // Handle noteDetailMap structure
  if (!note && state.note?.noteDetailMap) {
     const mapKeys = Object.keys(state.note.noteDetailMap);
     if (mapKeys.length > 0) {
       note = state.note.noteDetailMap[mapKeys[0]].note;
     }
  }

  // Handle mobile/other structures
  if (!note && state.data?.note) {
      note = state.data.note;
  }
  
  // Handle "feed" structure (sometimes seen in explore pages)
  if (!note && state.feed?.items?.[0]?.note) {
      note = state.feed.items[0].note;
  }

  if (!note) {
    console.log("Parsed State:", state); // Debug log
    throw new Error("未找到笔记详情数据 (可能需要验证码或登录)");
  }

  // 5. Process Images
  const imageList = note.imageList || [];
  const images: XhsImage[] = imageList.map((img: any, index: number) => {
    let originalUrl = img.urlDefault || img.url || '';
    
    // Standardize HTTPS
    if (originalUrl.startsWith('http://')) {
      originalUrl = originalUrl.replace('http://', 'https://');
    }

    // Clean URL logic
    let cleanUrl = originalUrl;
    if (cleanUrl.includes('!')) {
      cleanUrl = cleanUrl.split('!')[0];
    }

    return {
      id: img.fileId || `img_${index}_${Date.now()}`,
      url: cleanUrl,
      previewUrl: originalUrl,
      width: img.width || 1080,
      height: img.height || 1440,
      aiName: undefined
    };
  });

  return {
    id: note.noteId || note.id,
    title: note.title || note.desc?.slice(0, 50) || '无标题',
    author: note.user?.nickname || '匿名用户',
    authorAvatar: note.user?.avatar || '',
    images: images,
    timestamp: note.time || Date.now(),
  };
};

export const cleanXhsUrl = (url: string): string => {
  if (url.includes('!')) return url.split('!')[0];
  return url;
};