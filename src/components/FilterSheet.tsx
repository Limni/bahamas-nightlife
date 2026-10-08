import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useDirectory } from '@/lib/directory';
import { activeFilterCount, useFilters } from '@/lib/filters';
import { Chip } from './ui';

const PRICE_OPTIONS = [
  { level: 1, label: '$', hint: 'Budget' },
  { level: 2, label: '$$', hint: 'Moderate' },
  { level: 3, label: '$$$', hint: 'Pricey' },
  { level: 4, label: '$$$$', hint: 'Splurge' },
];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="text-xs font-extrabold uppercase tracking-widest text-brand-300 mb-2.5">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

/** Full filter panel: bottom sheet on phones, centred dialog on desktop. */
export function FilterSheet({ open, onClose, resultCount }: { open: boolean; onClose: () => void; resultCount: number }) {
  const { tagsOf } = useDirectory();
  const { filters, setFilters, toggle, clear } = useFilters();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[3000] flex items-end md:items-center justify-center">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-label="Filters"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="relative w-full md:max-w-xl max-h-[88vh] bg-night-900 border border-white/10 rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col"
          >
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <h2 className="text-xl font-extrabold text-white">Filters</h2>
              <button onClick={onClose} className="p-2 bg-white/5 text-brand-300 rounded-full hover:bg-white/10" aria-label="Close filters">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-4">
              <Group title="Right now">
                <Chip active={filters.openNow} onClick={() => setFilters((f) => ({ ...f, openNow: !f.openNow }))}>
                  <span className={`w-2 h-2 rounded-full ${filters.openNow ? 'bg-white' : 'bg-emerald-400'}`} /> Open now
                </Chip>
                <Chip active={filters.busyNow} onClick={() => setFilters((f) => ({ ...f, busyNow: !f.busyNow }))}>
                  <span className="heat-dot" style={{ color: filters.busyNow ? 'white' : 'var(--color-heat-lively)', width: 8, height: 8 }} /> Buzzing now
                </Chip>
              </Group>

              <Group title="Type of spot">
                {tagsOf('category').map((c) => (
                  <Chip key={c} active={filters.categories.includes(c)} onClick={() => toggle('categories', c)}>
                    {c}
                  </Chip>
                ))}
              </Group>

              <Group title="Vibe">
                {tagsOf('vibe').map((v) => (
                  <Chip key={v} active={filters.vibes.includes(v)} onClick={() => toggle('vibes', v)}>
                    {v}
                  </Chip>
                ))}
              </Group>

              <Group title="Price">
                {PRICE_OPTIONS.map((p) => (
                  <Chip key={p.level} active={filters.prices.includes(p.level)} onClick={() => toggle('prices', p.level)}>
                    {p.label} <span className="font-semibold opacity-70">{p.hint}</span>
                  </Chip>
                ))}
              </Group>

              <Group title="Area">
                {tagsOf('area').map((a) => (
                  <Chip key={a} active={filters.areas.includes(a)} onClick={() => toggle('areas', a)}>
                    {a}
                  </Chip>
                ))}
              </Group>
            </div>

            <div className="flex gap-3 px-6 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-white/10">
              <button
                onClick={clear}
                disabled={activeFilterCount(filters) === 0}
                className="px-5 py-3 rounded-2xl font-extrabold text-brand-200 hover:bg-white/5 disabled:opacity-40"
              >
                Clear all
              </button>
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-2xl font-extrabold text-white bg-gradient-to-r from-brand-500 to-glow-500 hover:brightness-110 glow-brand"
              >
                Show {resultCount} {resultCount === 1 ? 'spot' : 'spots'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Search box + filter button. `glass` is the floating style used over the map. */
export function SearchFilterBar({ onOpenFilters, glass }: { onOpenFilters: () => void; glass?: boolean }) {
  const { filters, setFilters } = useFilters();
  const count = activeFilterCount(filters);
  return (
    <div className="flex items-center gap-2 w-full">
      <label
        className={`flex-1 min-w-0 flex items-center gap-3 px-4 py-3.5 rounded-3xl border ${
          glass
            ? 'bg-night-900/90 backdrop-blur-md border-white/15 shadow-[0_8px_30px_rgb(0,0,0,0.45)]'
            : 'bg-night-950/70 border-white/15 focus-within:border-brand-400/70 focus-within:glow-brand-soft'
        }`}
      >
        <Search className="w-5 h-5 text-brand-400 shrink-0" />
        <input
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          placeholder="Search bars, clubs, vibes, areas…"
          aria-label="Search venues"
          className="flex-1 min-w-0 bg-transparent outline-none text-night-50 placeholder:text-night-400 font-semibold"
        />
        {filters.q && (
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, q: '' }))}
            aria-label="Clear search"
            className="text-brand-400 hover:text-brand-200"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </label>
      <button
        onClick={onOpenFilters}
        aria-label={`Filters${count ? ` (${count} active)` : ''}`}
        className={`relative shrink-0 w-[54px] h-[54px] rounded-3xl flex items-center justify-center border transition-all active:scale-95 ${
          count
            ? 'bg-brand-500 border-brand-400 text-white glow-brand'
            : glass
              ? 'bg-night-900/90 backdrop-blur-md border-white/15 text-brand-300 shadow-[0_8px_30px_rgb(0,0,0,0.45)]'
              : 'bg-night-950/70 border-white/15 text-brand-300 hover:bg-white/5'
        }`}
      >
        <SlidersHorizontal className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-amber-400 text-amber-950 text-[11px] font-black flex items-center justify-center border-2 border-night-950">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}

/** Horizontal row of one-tap filters (Buzzing now, Open now, prices, top vibes). */
export function QuickFilters({ glass }: { glass?: boolean }) {
  const { tagsOf } = useDirectory();
  const { filters, setFilters, toggle } = useFilters();
  const vibes = tagsOf('vibe').slice(0, 6);
  // Keep any selected vibe visible even if it isn't in the first few.
  const shown = [...new Set([...filters.vibes, ...vibes])];
  return (
    <div className={`flex gap-2 overflow-x-auto no-scrollbar py-1 ${glass ? '' : '-mx-4 px-4'}`}>
      <Chip size="sm" active={filters.busyNow} onClick={() => setFilters((f) => ({ ...f, busyNow: !f.busyNow }))}>
        <span className="heat-dot" style={{ color: filters.busyNow ? 'white' : 'var(--color-heat-lively)', width: 6, height: 6 }} /> Buzzing now
      </Chip>
      <Chip size="sm" active={filters.openNow} onClick={() => setFilters((f) => ({ ...f, openNow: !f.openNow }))}>
        <span className={`w-1.5 h-1.5 rounded-full ${filters.openNow ? 'bg-white' : 'bg-emerald-400'}`} /> Open now
      </Chip>
      {[1, 2, 3].map((p) => (
        <Chip key={p} size="sm" active={filters.prices.includes(p)} onClick={() => toggle('prices', p)}>
          {'$'.repeat(p)}
        </Chip>
      ))}
      {shown.map((v) => (
        <Chip key={v} size="sm" active={filters.vibes.includes(v)} onClick={() => toggle('vibes', v)}>
          {v}
        </Chip>
      ))}
    </div>
  );
}
