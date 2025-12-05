import React from 'react';
import { Check, Maximize2, AlertCircle } from 'lucide-react';
import { XhsImage } from '../types';

interface ImageCardProps {
  image: XhsImage;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onPreview: (url: string) => void;
  hasError?: boolean;
}

export const ImageCard: React.FC<ImageCardProps> = ({ image, isSelected, onToggle, onPreview, hasError }) => {
  // Use direct URL. The service now preserves auth tokens (?), so direct access 
  // with referrerPolicy="no-referrer" should work without 403s.
  const displaySrc = image.previewUrl;

  return (
    <div 
      className={`relative group rounded-xl overflow-hidden cursor-pointer transition-all duration-300 ${
        isSelected ? 'ring-4 ring-xhs-red shadow-lg' : 'shadow-sm hover:shadow-md'
      } ${hasError ? 'ring-4 ring-red-500' : ''}`}
      onClick={() => onToggle(image.id)}
    >
      {/* Aspect Ratio Container - Enforcing 3:4 Ratio for Uniform Grid */}
      <div className="relative aspect-[3/4]">
        <img 
          src={displaySrc} 
          alt={image.aiName || "xhs-image"} 
          className="w-full h-full object-cover bg-gray-100"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
        
        {/* Selection Overlay */}
        <div className={`absolute inset-0 bg-black/20 transition-opacity duration-200 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />

        {/* Checkbox */}
        <div className={`absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all ${
          isSelected ? 'bg-xhs-red border-xhs-red' : 'bg-black/30 border-white'
        }`}>
          {isSelected && <Check size={14} className="text-white" />}
        </div>

        {/* Error Badge */}
        {hasError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[1px]">
             <div className="bg-red-500 text-white px-3 py-1.5 rounded-full flex items-center gap-1 text-xs font-bold shadow-lg">
                <AlertCircle size={14} />
                下载失败
             </div>
          </div>
        )}

        {/* AI Name Tag */}
        {image.aiName && !hasError && (
          <div className="absolute bottom-2 left-2 right-2">
            <div className="bg-black/60 backdrop-blur-sm text-white text-[10px] px-2 py-1 rounded-md truncate">
              ✨ {image.aiName}
            </div>
          </div>
        )}

        {/* Preview Button */}
        <button 
          onClick={(e) => {
            e.stopPropagation();
            // Use previewUrl (Original URL) which is known to work in the browser, 
            // instead of the cleaned HQ URL which might trigger 403s.
            onPreview(image.previewUrl); 
          }}
          className="absolute top-3 left-3 p-1.5 bg-black/30 backdrop-blur-sm rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/50"
        >
          <Maximize2 size={12} />
        </button>
      </div>
    </div>
  );
};