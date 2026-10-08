import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

export interface LightboxImage {
  url: string;
  caption?: string | null;
}

/** Full-screen photo viewer: arrows / swipe / keyboard to move, Esc to close. */
export function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: LightboxImage[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const touchX = useRef<number | null>(null);
  const open = index !== null && images.length > 0;
  const i = index ?? 0;
  const prev = () => onIndex((i - 1 + images.length) % images.length);
  const next = () => onIndex((i + 1) % images.length);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  });

  if (!open) return null;
  const img = images[i];

  return createPortal(
    <div
      className="fixed inset-0 z-[5000] bg-black/95 flex flex-col"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 50) (dx > 0 ? prev : next)();
      }}
    >
      <div className="flex items-center justify-between p-4 text-white/80 text-sm font-bold">
        <span>
          {i + 1} / {images.length}
        </span>
        <button onClick={onClose} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white" aria-label="Close">
          <X className="w-6 h-6" />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center px-2 relative" onClick={onClose}>
        <img
          key={img.url}
          src={img.url}
          alt={img.caption ?? ''}
          className="max-w-full max-h-full object-contain select-none"
          onClick={(e) => e.stopPropagation()}
        />
        {images.length > 1 && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                prev();
              }}
              className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center"
              aria-label="Previous photo"
            >
              <ChevronLeft className="w-7 h-7" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                next();
              }}
              className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center"
              aria-label="Next photo"
            >
              <ChevronRight className="w-7 h-7" />
            </button>
          </>
        )}
      </div>
      <div className="min-h-16 px-6 py-4 text-center text-white/90 font-semibold pb-[max(1rem,env(safe-area-inset-bottom))]">
        {img.caption}
      </div>
    </div>,
    document.body,
  );
}
