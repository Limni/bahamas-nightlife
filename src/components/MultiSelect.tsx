import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X, type LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// A compact multi-select filter: one pill button ("Vibe ▾", "Vibe · 2") that
// opens a checklist. Desktop: a dropdown under the button. Phones: a bottom
// sheet with big rows and "Show N spots". Choices apply as you tick them, so
// the count is always live.
// ---------------------------------------------------------------------------

export function MultiSelect({
  label,
  icon: Icon,
  options,
  selected,
  onToggle,
  onClear,
  resultCount,
  iconFor,
}: {
  label: string;
  icon: LucideIcon;
  /** [value, spot count] */
  options: [string, number][];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  /** Spots matching all current filters, for the phone sheet's button. */
  resultCount: number;
  iconFor?: (value: string) => LucideIcon | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const searchable = options.length > 10;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    // Desktop only: phones would pop the keyboard over the list.
    if (searchable && window.matchMedia('(min-width: 768px)').matches) search.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, searchable]);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter(([v]) => v.toLowerCase().includes(needle)) : options;
  }, [options, q]);

  if (!options.length) return null;
  const n = selected.length;
  const buttonText = n === 0 ? label : n === 1 ? selected[0] : `${label} · ${n}`;

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className={`max-w-full inline-flex items-center gap-1.5 pl-3 pr-2.5 py-2 rounded-full border text-sm font-bold transition-colors ${
          n ? 'bg-brand-500 border-brand-400 text-white glow-brand-soft' : 'bg-night-800/90 border-white/10 text-night-100 hover:border-brand-400/60'
        }`}
      >
        <Icon className={`w-4 h-4 shrink-0 ${n ? 'text-white' : 'text-brand-400'}`} />
        <span className="truncate max-w-[9rem] sm:max-w-[12rem]">{buttonText}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          {/* Phones: a dimmed backdrop; desktop: an invisible one that closes on an outside click. */}
          <div className="fixed inset-0 z-[2600] md:z-[1090] bg-night-950/70 md:bg-transparent" onClick={() => setOpen(false)} />
          <div
            id={id}
            role="dialog"
            aria-label={`Filter by ${label.toLowerCase()}`}
            className="fixed inset-x-0 bottom-0 z-[2600] max-h-[80dvh] rounded-t-3xl pb-[env(safe-area-inset-bottom)] md:absolute md:inset-auto md:left-0 md:top-full md:mt-2 md:z-[1100] md:w-80 md:max-h-none md:rounded-2xl md:pb-0 flex flex-col bg-night-900 ring-1 ring-white/10 shadow-2xl radio-rise"
          >
            <div className="md:hidden mx-auto mt-3 w-10 h-1 rounded-full bg-white/15" />
            <div className="flex items-center justify-between gap-3 px-4 pt-3 md:pt-3 pb-2">
              <p className="font-extrabold text-white flex items-center gap-2">
                <Icon className="w-4 h-4 text-brand-400" /> {label}
                {n > 0 && <span className="px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-200 text-xs">{n} selected</span>}
              </p>
              <button type="button" onClick={() => setOpen(false)} className="md:hidden p-1.5 -mr-1.5 rounded-full text-night-300 hover:bg-white/10" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            {searchable && (
              <div className="px-4 pb-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-night-400" />
                  <input
                    ref={search}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={`Search ${label.toLowerCase()}s`}
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-night-950/70 border border-white/10 text-sm font-semibold text-white placeholder:text-night-500 outline-none focus:border-brand-400"
                  />
                </div>
              </div>
            )}
            <ul className="flex-1 min-h-0 overflow-y-auto md:max-h-80 px-2 pb-2">
              {shown.map(([value, count]) => {
                const on = selected.includes(value);
                const VIcon = iconFor?.(value);
                return (
                  <li key={value}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => onToggle(value)}
                      className="w-full flex items-center gap-3 px-2.5 py-3 md:py-2 rounded-xl text-left hover:bg-white/5"
                    >
                      <span
                        className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${on ? 'bg-brand-500 border-brand-400' : 'border-white/25'}`}
                      >
                        {on && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                      </span>
                      {VIcon && <VIcon className="w-4 h-4 shrink-0 text-night-300" />}
                      <span className={`flex-1 min-w-0 truncate text-[15px] md:text-sm font-bold ${on ? 'text-white' : 'text-night-100'}`}>{value}</span>
                      {count > 0 && <span className="shrink-0 text-xs font-extrabold text-night-400">{count}</span>}
                    </button>
                  </li>
                );
              })}
              {shown.length === 0 && <li className="px-3 py-4 text-sm font-semibold text-night-400">No match for “{q}”.</li>}
            </ul>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
              <button type="button" onClick={onClear} disabled={!n} className="text-sm font-extrabold text-brand-300 hover:text-brand-200 disabled:text-night-500">
                Clear
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2.5 md:py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-white text-sm font-extrabold"
              >
                <span className="md:hidden">Show {resultCount} spot{resultCount === 1 ? '' : 's'}</span>
                <span className="hidden md:inline">Done</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
