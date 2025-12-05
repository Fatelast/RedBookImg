import { GoogleGenAI } from "@google/genai";
import { XhsImage } from "../types";
import { fetchBlobWithRetry } from "./xhsService";

const getBase64FromBlob = async (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      // Remove data:image/jpeg;base64, prefix
      const parts = base64.split(',');
      resolve(parts.length > 1 ? parts[1] : base64);
    };
    reader.onerror = reject;
  });
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const generateSmartNames = async (images: XhsImage[], apiKey: string): Promise<XhsImage[]> => {
  if (!apiKey) {
    console.warn("No API Key provided for Gemini");
    return images;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const model = 'gemini-2.5-flash';

    // Process sequentially (Batch size 1) to prevent proxy rate limiting/network errors
    // "Failed to fetch" often occurs when hitting public proxies too hard.
    const updatedImages = [...images];
    const batchSize = 1; 
    
    for (let i = 0; i < updatedImages.length; i += batchSize) {
      const batch = updatedImages.slice(i, i + batchSize);
      
      const promises = batch.map(async (img) => {
        try {
          // OPTIMIZATION: Try fetching the preview URL first for AI analysis.
          // AI doesn't need 4K resolution, and preview URLs are often more reliable/smaller.
          let blob: Blob;
          try {
             // Try preview URL first (faster, likely smaller)
             blob = await fetchBlobWithRetry(img.previewUrl);
          } catch (e) {
             // Fallback to HQ URL if preview fails
             // console.warn(`Preview fetch failed for AI analysis of ${img.id}, trying HQ fallback...`);
             blob = await fetchBlobWithRetry(img.url);
          }

          const base64Data = await getBase64FromBlob(blob);
          
          const response = await ai.models.generateContent({
            model,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: base64Data
                  }
                },
                {
                  text: "Analyze this image and generate a very short, descriptive filename in English (lowercase, kebab-case, no extension). Max 5 words. Example: 'girl-in-red-dress' or 'cat-sleeping-sofa'. Do not include file extension."
                }
              ]
            }
          });
          
          const name = response.text?.trim() || `image-${img.id}`;
          return { ...img, aiName: name.replace(/\s+/g, '-').toLowerCase() };
        } catch (error) {
          console.error(`Failed to name image ${img.id}`, error);
          return img; // Return original if fail
        }
      });

      const processedBatch = await Promise.all(promises);
      processedBatch.forEach((processedImg, idx) => {
        updatedImages[i + idx] = processedImg;
      });

      // Add delay between items to be gentle on proxies and avoid "Failed to fetch"
      if (i + batchSize < updatedImages.length) {
        await delay(1000);
      }
    }

    return updatedImages;

  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};