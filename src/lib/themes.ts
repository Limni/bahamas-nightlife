import { Ghost, Gift, Shell, type LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Public site themes. The admin picks one in /admin/theme and it's stored in
// site_settings.theme. Each id maps to a [data-theme="…"] block in index.css
// that re-points the night/brand/glow tokens, so components need no changes.
// ---------------------------------------------------------------------------

export type ThemeId = 'neon' | 'junkanoo' | 'halloween' | 'christmas';

export interface SiteTheme {
  id: ThemeId;
  name: string;
  blurb: string;
  /** <meta name="theme-color"> (the browser bar on phones) — the theme's night-950. */
  metaColor: string;
  /** Static colours for the admin preview card: board, primary, accent, page. */
  swatches: { board: string; primary: string; accent: string; page: string };
  /** Small seasonal pill on the Explore hero; the everyday look has none. */
  badge?: { label: string; icon: LucideIcon };
}

export const DEFAULT_THEME: ThemeId = 'neon';

export const THEMES: SiteTheme[] = [
  {
    id: 'neon',
    name: 'Neon nights',
    blurb: 'The everyday look: hot magenta and electric cyan on a violet-black sky.',
    metaColor: '#0a0714',
    swatches: { board: '#130e24', primary: '#f72fb0', accent: '#22d3ee', page: '#0a0714' },
  },
  {
    id: 'junkanoo',
    name: 'Junkanoo',
    blurb: 'Flamingo pink and Junkanoo gold over a deep-ocean night, with rolling waves.',
    metaColor: '#050e1f',
    swatches: { board: '#0b1830', primary: '#f03f78', accent: '#ffc72c', page: '#050e1f' },
    badge: { label: 'Rush out in style', icon: Shell },
  },
  {
    id: 'halloween',
    name: 'Halloween',
    blurb: 'Pumpkin orange and witchy violet under a full moon.',
    metaColor: '#08060c',
    swatches: { board: '#120d19', primary: '#f4620e', accent: '#ad74fb', page: '#08060c' },
    badge: { label: 'Spooky season', icon: Ghost },
  },
  {
    id: 'christmas',
    name: 'Christmas',
    blurb: 'Holly red, pine green and gold, with falling snow.',
    metaColor: '#06100c',
    swatches: { board: '#0c1a14', primary: '#e8364a', accent: '#e9b02a', page: '#06100c' },
    badge: { label: 'Party season', icon: Gift },
  },
];

export const isThemeId = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);

export const themeById = (id: string | null | undefined): SiteTheme =>
  THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
