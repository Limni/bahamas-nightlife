import { Play } from 'lucide-react';
import { isVideo, stillOf, type MediaFields } from '@/lib/types';
import type { LightboxImage } from './Lightbox';

/** 0:21 */
export const formatDuration = (s: number | null | undefined) => {
  if (!s || !Number.isFinite(s)) return null;
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export const toLightbox = (m: MediaFields): LightboxImage => ({
  url: m.url,
  caption: m.caption,
  video: isVideo(m),
  poster: m.poster_url ?? null,
});

/** Play button + length, laid over a video's poster. */
export function VideoBadge({ duration, size = 'md' }: { duration?: number | null; size?: 'sm' | 'md' | 'lg' }) {
  const len = formatDuration(duration);
  const circle = size === 'lg' ? 'w-16 h-16' : size === 'sm' ? 'w-8 h-8' : 'w-11 h-11';
  const icon = size === 'lg' ? 'w-7 h-7' : size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5';
  return (
    <>
      <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className={`${circle} rounded-full bg-black/55 backdrop-blur-sm ring-1 ring-white/30 flex items-center justify-center`}>
          <Play className={`${icon} text-white fill-white translate-x-[1px]`} />
        </span>
      </span>
      {len && size !== 'sm' && (
        <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/65 text-white text-[11px] font-bold tabular-nums pointer-events-none">
          {len}
        </span>
      )}
    </>
  );
}

/**
 * A photo, or a video's poster with a play badge, filling its box. Videos are
 * never loaded here (only their poster), so grids stay light on data.
 * natural = keep the image's own height (masonry grids).
 */
export function MediaStill({ m, className = '', natural = false }: { m: MediaFields; className?: string; natural?: boolean }) {
  const still = stillOf(m);
  return (
    <span className={`relative block ${className}`}>
      {still ? (
        <img
          src={still}
          alt={m.caption ?? ''}
          loading="lazy"
          decoding="async"
          className={natural ? 'w-full h-auto' : 'w-full h-full object-cover'}
        />
      ) : (
        <span className={`block w-full bg-gradient-to-br from-night-800 to-night-950 ${natural ? 'aspect-video' : 'h-full'}`} />
      )}
      {isVideo(m) && <VideoBadge duration={m.duration_s} />}
    </span>
  );
}
