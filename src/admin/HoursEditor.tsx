import { Copy } from 'lucide-react';
import { DAY_NAMES, type WeeklyHours } from '@/lib/hours';

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first, like a menu board
const timeClass =
  'px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-900 outline-none focus:border-brand-500 w-[7.5rem]';

/**
 * 7-day open/close editor (Bahamas local time; new days default to 8 PM–2 AM). Unchecked day = closed. A close
 * time earlier than the open time means it runs past midnight.
 */
export function HoursEditor({ value, onChange }: { value: WeeklyHours; onChange: (next: WeeklyHours) => void }) {
  const setDay = (d: number, patch: { open?: string; close?: string } | null) => {
    const key = String(d);
    const next = { ...value };
    if (patch === null) delete next[key];
    else next[key] = { open: value[key]?.open ?? '20:00', close: value[key]?.close ?? '02:00', ...patch };
    onChange(next);
  };

  const copyToAll = (d: number) => {
    const src = value[String(d)];
    if (!src) return;
    const next: WeeklyHours = {};
    for (const day of ORDER) next[String(day)] = { ...src };
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {ORDER.map((d) => {
        const day = value[String(d)];
        return (
          <div key={d} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1">
            <label className="flex items-center gap-2 w-28 cursor-pointer">
              <input type="checkbox" checked={!!day} onChange={(e) => setDay(d, e.target.checked ? {} : null)} className="w-4 h-4 accent-brand-600" />
              <span className="text-sm font-extrabold text-slate-800">{DAY_NAMES[d].slice(0, 3)}</span>
            </label>
            {day ? (
              <div className="flex items-center gap-2">
                <input type="time" value={day.open} onChange={(e) => setDay(d, { open: e.target.value })} className={timeClass} />
                <span className="text-xs font-bold text-slate-400">to</span>
                <input type="time" value={day.close} onChange={(e) => setDay(d, { close: e.target.value })} className={timeClass} />
                <button type="button" onClick={() => copyToAll(d)} title="Copy these hours to every day" className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50">
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <span className="text-sm font-bold text-slate-400">Closed</span>
            )}
          </div>
        );
      })}
      <p className="text-xs font-semibold text-slate-400 pt-1">Tip: set one day, then tap the copy icon to apply it to the whole week.</p>
    </div>
  );
}
