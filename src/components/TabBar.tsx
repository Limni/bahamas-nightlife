import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
}

/**
 * Pill tab bar that scrolls sideways when the tabs don't fit (a venue with
 * Drinks + Food + counts overflows a phone). Arrows with a fade appear on
 * whichever side has more tabs, and the active tab is kept in view.
 */
export function TabBar<K extends string>({ tabs, active, onChange }: { tabs: TabItem<K>[]; active: K; onChange: (key: K) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // A few px of slack: sub-pixel widths otherwise leave an arrow showing at the end.
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [measure, tabs.length]);

  // Bring the active tab into view (e.g. opening ?tab=reviews on a phone).
  // Scrolls only the bar, never the page, unlike scrollIntoView.
  useEffect(() => {
    const el = scroller.current;
    const tab = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !tab) return;
    const pad = 40; // clear the arrow + fade
    if (tab.offsetLeft < el.scrollLeft + pad) el.scrollTo({ left: tab.offsetLeft - pad, behavior: 'smooth' });
    else if (tab.offsetLeft + tab.offsetWidth > el.scrollLeft + el.clientWidth - pad)
      el.scrollTo({ left: tab.offsetLeft + tab.offsetWidth - el.clientWidth + pad, behavior: 'smooth' });
  }, [active, tabs.length]);

  const nudge = (dir: -1 | 1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.6, behavior: 'smooth' });
  };

  const arrow = 'absolute inset-y-0 w-11 flex items-center text-white z-10';

  return (
    <div className="relative bg-night-900 rounded-2xl border border-white/10 w-full sm:w-fit max-w-full overflow-hidden">
      <div ref={scroller} role="tablist" className="relative flex gap-1 p-1 overflow-x-auto no-scrollbar">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.key)}
              className={`flex-1 shrink-0 sm:flex-none whitespace-nowrap px-3.5 sm:px-5 py-2.5 rounded-xl text-sm font-extrabold transition-colors ${
                on ? 'bg-brand-500 text-white' : 'text-night-200 hover:bg-white/5'
              }`}
            >
              {t.label}
              {t.count ? <span className={`ml-1.5 text-xs ${on ? 'text-brand-100' : 'text-night-400'}`}>{t.count}</span> : null}
            </button>
          );
        })}
      </div>
      {edges.left && (
        <button
          type="button"
          onClick={() => nudge(-1)}
          aria-label="Show earlier tabs"
          className={`${arrow} left-0 justify-start pl-1.5 bg-gradient-to-r from-night-900 via-night-900/90 to-transparent`}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}
      {edges.right && (
        <button
          type="button"
          onClick={() => nudge(1)}
          aria-label="Show more tabs"
          className={`${arrow} right-0 justify-end pr-1.5 bg-gradient-to-l from-night-900 via-night-900/90 to-transparent`}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
