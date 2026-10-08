import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Eye, X } from 'lucide-react';
import { supabase, supabaseConfigured } from './supabase';
import { DEFAULT_THEME, isThemeId, themeById, type SiteTheme, type ThemeId } from './themes';

// ---------------------------------------------------------------------------
// The public theme lives in site_settings (one row, admin-editable). The last
// value is cached in localStorage and painted before React mounts, so repeat
// visits don’t flash the neon palette. "/?theme=<id>" previews a theme in
// this tab only (sessionStorage) — that's how the admin checks one before
// switching everybody over.
// ---------------------------------------------------------------------------

const CACHE_KEY = 'theme:v1';
const PREVIEW_KEY = 'theme:preview';

function readCached(): ThemeId {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    return isThemeId(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function readPreview(): ThemeId | null {
  try {
    const v = sessionStorage.getItem(PREVIEW_KEY);
    return isThemeId(v) ? v : null;
  } catch {
    return null;
  }
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeById(id).metaColor);
}

/** Call once before rendering: picks up a ?theme= preview and paints the cached theme. */
export function initTheme() {
  const url = new URL(window.location.href);
  const param = url.searchParams.get('theme');
  if (param !== null) {
    try {
      // Any unknown value (e.g. ?theme=off) ends a preview.
      if (isThemeId(param)) sessionStorage.setItem(PREVIEW_KEY, param);
      else sessionStorage.removeItem(PREVIEW_KEY);
    } catch {
      /* private mode */
    }
    url.searchParams.delete('theme');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  applyTheme(readPreview() ?? readCached());
}

interface ThemeState {
  /** What's on screen: the preview if there is one, else the site theme. */
  theme: SiteTheme;
  activeId: ThemeId;
  previewId: ThemeId | null;
  /** Local update after the admin saves (Realtime also delivers it). */
  setActive: (id: ThemeId) => void;
  exitPreview: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<ThemeId>(readCached);
  const [previewId, setPreviewId] = useState<ThemeId | null>(readPreview);

  const setActive = useCallback((id: ThemeId) => {
    setActiveId(id);
    try {
      localStorage.setItem(CACHE_KEY, id);
    } catch {
      /* storage full / private mode */
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    const accept = (v: unknown) => setActive(isThemeId(v) ? v : DEFAULT_THEME);
    // If the table doesn't exist yet (schema not re-run), keep the cached theme.
    supabase
      .from('site_settings')
      .select('theme')
      .maybeSingle()
      .then(({ data }) => {
        if (data) accept(data.theme);
      });
    const channel = supabase
      .channel('site-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, (payload) => {
        const next = (payload.new as { theme?: string } | null)?.theme;
        if (next !== undefined) accept(next);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [setActive]);

  const shownId = previewId ?? activeId;
  useEffect(() => {
    applyTheme(shownId);
  }, [shownId]);

  const exitPreview = useCallback(() => {
    try {
      sessionStorage.removeItem(PREVIEW_KEY);
    } catch {
      /* private mode */
    }
    setPreviewId(null);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: themeById(shownId), activeId, previewId, setActive, exitPreview }}>
      {children}
      {previewId && previewId !== activeId && (
        <div className="fixed left-3 bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-4 z-[1600] flex items-center gap-2 pl-3.5 pr-1.5 py-1.5 rounded-full bg-night-800 text-white ring-1 ring-white/10 text-xs font-extrabold shadow-xl">
          <Eye className="w-4 h-4 text-glow-300" />
          Previewing {themeById(previewId).name}
          <button onClick={exitPreview} className="p-1 rounded-full hover:bg-white/15" aria-label="Exit theme preview">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </ThemeContext.Provider>
  );
}

export function useSiteTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useSiteTheme must be used inside <ThemeProvider>');
  return ctx;
}
