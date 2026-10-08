import { useState } from 'react';
import { CheckCircle2, Eye } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSiteTheme } from '@/lib/theme';
import { THEMES, type SiteTheme } from '@/lib/themes';
import { Button, useFeedback } from './ui';

/** A tiny mock of the Explore hero in the theme's colours (static swatches, not live CSS). */
function Mock({ theme }: { theme: SiteTheme }) {
  const { board, primary, accent, page } = theme.swatches;
  const Badge = theme.badge?.icon;
  return (
    <div className="p-3 rounded-xl" style={{ backgroundColor: page }}>
      <div className="rounded-lg p-3.5" style={{ backgroundColor: board }}>
        {Badge && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 mb-1.5 rounded-full bg-white/10 text-[10px] font-extrabold text-white/85">
            <Badge className="w-3 h-3" style={{ color: accent }} /> {theme.badge!.label}
          </span>
        )}
        <p className="font-display text-base font-extrabold leading-tight text-white/95">
          Nassau after{' '}
          <span style={{ color: accent, textShadow: `0 0 12px ${accent}` }}>
            dark.
          </span>
        </p>
        <span className="mt-2.5 inline-block px-3 py-1 rounded-full text-[11px] font-extrabold text-white" style={{ backgroundColor: primary }}>
          Busy now
        </span>
      </div>
    </div>
  );
}

export default function ThemeSettings() {
  const { activeId, setActive } = useSiteTheme();
  const { toast } = useFeedback();
  const [saving, setSaving] = useState<string | null>(null);

  const activate = async (t: SiteTheme) => {
    setSaving(t.id);
    const { data, error } = await supabase.from('site_settings').update({ theme: t.id }).eq('id', true).select('theme');
    setSaving(null);
    if (error) {
      return toast(
        error.code === '42P01' || /site_settings/.test(error.message)
          ? 'The theme setting isn’t in the database yet. Re-run supabase/schema.sql.'
          : error.message,
        'error',
      );
    }
    // RLS turns a missing row / non-admin update into "0 rows", not an error.
    if (!data?.length) return toast('Nothing was saved. Re-run supabase/schema.sql to create the settings row.', 'error');
    setActive(t.id);
    toast(`${t.name} is now live for everyone`);
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Theme</h1>
        <p className="text-sm font-semibold text-slate-500">
          Pick the look every visitor sees. It switches open pages straight away, no reload needed. Use Preview to check a theme in a new tab first.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 md:gap-4">
        {THEMES.map((t) => {
          const live = t.id === activeId;
          return (
            <section
              key={t.id}
              className={`bg-white rounded-2xl border shadow-sm p-3 flex flex-col ${live ? 'border-brand-500 ring-2 ring-brand-500/25' : 'border-slate-200'}`}
            >
              <Mock theme={t} />
              <div className="px-1 pt-3 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-extrabold">{t.name}</h2>
                  {live && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-extrabold">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Live
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-500 mt-0.5">{t.blurb}</p>
              </div>
              <div className="px-1 pt-3 flex gap-2">
                <a
                  href={`/?theme=${t.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200"
                >
                  <Eye className="w-4 h-4" /> Preview
                </a>
                {!live && (
                  <Button onClick={() => activate(t)} loading={saving === t.id} disabled={saving !== null} className="flex-1">
                    Make live
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
