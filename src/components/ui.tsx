import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { openState, openStatusText, type WeeklyHours } from '@/lib/hours';
import { priceLabel } from '@/lib/types';
import { VS_USUAL_TEXT, type Heat } from '@/lib/activity';

export function Chip({
  active,
  onClick,
  children,
  size = 'md',
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border font-bold transition-all active:scale-95 ${
        size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-2 text-sm'
      } ${
        active
          ? 'bg-brand-500 border-brand-400 text-white glow-brand'
          : 'bg-night-800/90 border-white/10 text-night-100 hover:border-brand-400/60 hover:bg-night-700'
      }`}
    >
      {children}
    </button>
  );
}

export function OpenBadge({ hours, now, compact }: { hours: WeeklyHours | null; now?: number; compact?: boolean }) {
  const state = openState(hours, now);
  if (state.kind === 'unknown') return null;
  const open = state.kind === 'open';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${open ? 'text-emerald-400' : 'text-night-300'}`}>
      <span className={`w-2 h-2 rounded-full ${open ? 'bg-emerald-400 glow-live' : 'bg-night-500'}`} />
      {compact ? (open ? 'Open now' : 'Closed') : openStatusText(state, now)}
    </span>
  );
}

export function Price({ level, className = '' }: { level: number | null; className?: string }) {
  if (!level) return null;
  return (
    <span className={`font-extrabold tracking-tight ${className}`} aria-label={`Price level ${level} of 4`}>
      <span className="text-glow-300">{priceLabel(level)}</span>
      <span className="text-night-600">{'$'.repeat(4 - level)}</span>
    </span>
  );
}

/** Live activity: a glowing dot + level ("Packed"), optionally with the vs-usual line. */
export function HeatBadge({ heat, showUsual = false, className = '' }: { heat: Heat; showUsual?: boolean; className?: string }) {
  if (heat.level === 'quiet') return null;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-extrabold ${className}`} style={{ color: heat.color }}>
      <span className={`heat-dot ${heat.level === 'packed' || heat.vsUsual === 'busier' ? 'pulse' : ''}`} />
      {heat.label}
      {showUsual && heat.vsUsual && <span className="font-bold text-night-300">· {VS_USUAL_TEXT[heat.vsUsual]}</span>}
    </span>
  );
}

/** Pill version for photos (cards, rails). */
export function HeatPill({ heat }: { heat: Heat }) {
  if (heat.level === 'quiet') return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-night-950/80 backdrop-blur ring-1 ring-white/10"
      style={{ color: heat.color }}
    >
      <span className={`heat-dot ${heat.level === 'packed' ? 'pulse' : ''}`} />
      {heat.label}
      {heat.vsUsual === 'busier' && <span className="text-white/80">↑</span>}
    </span>
  );
}

export function Spinner({ className = 'w-6 h-6' }: { className?: string }) {
  return <Loader2 className={`animate-spin text-brand-400 ${className}`} />;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="text-center py-16 px-6">
      <div className="w-16 h-16 mx-auto rounded-3xl bg-brand-500/10 border border-brand-400/25 flex items-center justify-center text-brand-300 mb-4 glow-brand-soft">
        {icon}
      </div>
      <h3 className="text-lg font-bold text-white mb-1">{title}</h3>
      {children && <div className="text-sm text-night-300 max-w-sm mx-auto">{children}</div>}
    </div>
  );
}

/** Neon placeholder (the venue's initial on a glowing gradient) when there's no cover photo yet. */
export function CoverPlaceholder({ name, className = '' }: { name: string; className?: string }) {
  return (
    <div className={`relative bg-gradient-to-br from-night-800 via-brand-900 to-night-900 flex items-center justify-center overflow-hidden ${className}`}>
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 15%, var(--color-brand-500), transparent 45%), radial-gradient(circle at 85% 90%, var(--color-glow-500), transparent 45%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-30"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.35) 1px, transparent 1px)', backgroundSize: '16px 16px' }}
      />
      <span className="relative font-display font-extrabold text-4xl text-brand-200 neon-text">{name.trim().charAt(0).toUpperCase() || '?'}</span>
    </div>
  );
}

/** Image that falls back to the neon placeholder if the URL is missing or fails to load. */
export function SafeImg({ src, name, className = '', lazy = true }: { src: string | null | undefined; name: string; className?: string; lazy?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <CoverPlaceholder name={name} className={className} />;
  return (
    <img
      src={src}
      alt=""
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
      onError={() => setFailed(src)}
      className={`object-cover ${className}`}
    />
  );
}

const STAR_PATH = 'M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96L12 2.5z';

/** Read-only stars; fractional values fill partially (e.g. 4.3 shows 4⅓ stars). */
export function Stars({ value, size = 16, className = '' }: { value: number; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center ${className}`} aria-label={`${value.toFixed(1)} out of 5 stars`} role="img">
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <svg viewBox="0 0 24 24" width={size} height={size} className="absolute inset-0 text-night-700" fill="currentColor" aria-hidden>
              <path d={STAR_PATH} />
            </svg>
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <svg viewBox="0 0 24 24" width={size} height={size} className="text-amber-400" fill="currentColor" aria-hidden>
                <path d={STAR_PATH} />
              </svg>
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Tap-to-rate input (1–5). */
export function StarInput({ value, onChange, size = 34 }: { value: number; onChange: (v: number) => void; size?: number }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  const labels = ['', 'Not great', 'It was OK', 'Good night', 'Great night', 'Legendary'];
  return (
    <div className="flex items-center gap-3">
      <div className="flex" onMouseLeave={() => setHover(0)} role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            className="p-0.5 transition-transform active:scale-90 hover:scale-110"
          >
            <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={n <= shown ? 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]' : 'text-night-700'}>
              <path d={STAR_PATH} />
            </svg>
          </button>
        ))}
      </div>
      {shown > 0 && <span className="text-sm font-extrabold text-night-100">{labels[shown]}</span>}
    </div>
  );
}

/** Compact "★ 4.6 (12)" badge; renders nothing when a spot has no ratings yet. */
export function RatingBadge({ summary, className = '' }: { summary?: { rating_avg: number; rating_count: number }; className?: string }) {
  if (!summary || !summary.rating_count) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-extrabold text-white ${className}`}>
      <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" className="text-amber-400" aria-hidden>
        <path d={STAR_PATH} />
      </svg>
      {summary.rating_avg.toFixed(1)}
      <span className="font-bold text-night-300">({summary.rating_count})</span>
    </span>
  );
}
