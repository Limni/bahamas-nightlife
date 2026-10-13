import type { MouseEvent } from 'react';
import { Heart } from 'lucide-react';
import { useFavorites } from '@/lib/favorites';

/**
 * Heart that adds a spot to (or removes it from) the member's favourites.
 *   overlay — round button over a card photo
 *   hero    — beside Share over the venue page's hero photo
 *   tile    — a footer tile in the map drawer
 * Renders nothing until the favourites table exists.
 */
export function FavoriteButton({ venueId, name, variant }: { venueId: string; name: string; variant: 'overlay' | 'hero' | 'tile' }) {
  const { available, isFavorite, toggle } = useFavorites();
  if (!available) return null;
  const on = isFavorite(venueId);
  const onClick = (e: MouseEvent) => {
    // Cards are links: a tap on the heart mustn't open the spot.
    e.preventDefault();
    e.stopPropagation();
    toggle(venueId);
  };
  const label = on ? `Remove ${name} from your favourites` : `Add ${name} to your favourites`;
  const icon = (size: string) => <Heart className={`${size} transition-transform ${on ? 'fill-current scale-110' : ''}`} />;

  if (variant === 'overlay') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={on}
        aria-label={label}
        title={on ? 'In your favourites' : 'Add to favourites'}
        className={`w-9 h-9 rounded-full flex items-center justify-center backdrop-blur ring-1 transition-colors ${
          on ? 'bg-brand-500 text-white ring-brand-300/60 glow-brand-soft' : 'bg-night-950/70 text-white ring-white/15 hover:bg-night-950/90'
        }`}
      >
        {icon('w-[18px] h-[18px]')}
      </button>
    );
  }
  if (variant === 'tile') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={on}
        aria-label={label}
        className={`flex flex-col items-center justify-center px-3 rounded-2xl border min-w-[64px] transition-colors ${
          on ? 'bg-brand-500/20 border-brand-400/50 text-brand-200' : 'bg-white/5 border-white/10 text-night-100 hover:border-white/20'
        }`}
      >
        {icon('w-5 h-5')}
        <span className="text-xs font-bold mt-0.5">{on ? 'Saved' : 'Save'}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={on ? 'In your favourites' : 'Add to favourites'}
      className={`w-11 h-11 rounded-full backdrop-blur flex items-center justify-center shadow-lg transition-colors ${
        on ? 'bg-brand-500 text-white glow-brand-soft' : 'bg-night-900/90 text-night-100 hover:bg-night-900'
      }`}
    >
      {icon('w-5 h-5')}
    </button>
  );
}
