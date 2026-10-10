import { ActivityStatus } from './ActivityStatus';
import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { HEAT_META, heatFor, useActivity, usePopularTimes, VS_USUAL_TEXT } from '@/lib/activity';
import { DAY_NAMES, todayIndex } from '@/lib/hours';

// The chart covers a night, not a calendar day: noon → 5 AM, where the hours
// after midnight come from the next weekday's averages ("Friday night" runs
// into Saturday morning).
const NIGHT_HOURS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4];
const FLOOR = 6; // same "full" floor as heatFor(), so sparse history doesn't overstate

const hourLabel = (h: number) => (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`);
const hourLong = (h: number) => (h === 0 ? 'midnight' : h === 12 ? 'noon' : h < 12 ? `${h} AM` : `${h - 12} PM`);

function nassauHour(now: number) {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Nassau', hour: '2-digit', hour12: false }).format(new Date(now)), 10) % 24;
}

/** The night "now" belongs to: before 5 AM it's still last night. */
function currentNight(now: number) {
  const dow = todayIndex(now);
  return nassauHour(now) < 5 ? (dow + 6) % 7 : dow;
}

/** "Popular times": usual crowd per hour for a chosen night, with tonight's live level on top. */
export function PopularTimes({ venueId, now }: { venueId: string; now: number }) {
  const typical = usePopularTimes(venueId);
  const { activity } = useActivity();
  const heat = heatFor(activity[venueId]);
  const tonight = currentNight(now);
  const [night, setNight] = useState(tonight);
  const [hover, setHover] = useState<number | null>(null);
  const hourNow = nassauHour(now);

  const series = useMemo(() => {
    if (!typical) return null;
    return NIGHT_HOURS.map((h) => ({ h, v: typical[h < 5 ? (night + 1) % 7 : night][h] }));
  }, [typical, night]);

  const scale = useMemo(() => Math.max(FLOOR, ...(typical ?? []).flat()), [typical]);

  if (!typical || !series) {
    return (
      <div className="text-sm text-night-300"><ActivityStatus />
        <p className="flex items-center gap-2 font-bold text-night-200">
          <BarChart3 className="w-4 h-4 text-brand-400" /> No crowd history yet
        </p>
        <p className="mt-1">Popular times appear after a few nights of anonymous check-ins from people with live activity sharing on.</p>
      </div>
    );
  }

  const isTonight = night === tonight;
  const shown = hover ?? (isTonight ? NIGHT_HOURS.indexOf(hourNow) : -1);
  const focus = shown >= 0 ? series[shown] : null;

  return (
    <div>
      <ActivityStatus />
      <div className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1 pb-3">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <button
            key={d}
            onClick={() => setNight(d)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-extrabold transition-colors ${
              night === d ? 'bg-brand-500 text-white' : 'bg-white/5 text-night-200 hover:bg-white/10'
            }`}
          >
            {d === tonight ? 'Tonight' : DAY_NAMES[d].slice(0, 3)}
          </button>
        ))}
      </div>

      {/* Readout: hovered hour, else "now" on tonight's chart. */}
      <p className="min-h-10 text-sm text-night-200" aria-live="polite">
        {focus ? (
          <>
            <span className="font-extrabold text-white">{hourLong(focus.h)}</span>
            {' · usually '}
            <span className="font-bold text-white">{focus.v < 0.5 ? 'quiet' : HEAT_META[levelOf(focus.v, scale)].label.toLowerCase()}</span>
            {isTonight && focus.h === hourNow && hover === null && (
              <>
                <br />
                <span className="font-extrabold" style={{ color: heat.color }}>
                  Live: {heat.label}
                </span>
                {heat.vsUsual && <span className="text-night-300"> · {VS_USUAL_TEXT[heat.vsUsual]}</span>}
              </>
            )}
          </>
        ) : (
          <span className="text-night-300">Usual crowd by hour, from the last 8 weeks.</span>
        )}
      </p>

      <div className="relative mt-2 h-32 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
        {series.map(({ h, v }, i) => {
          const isNow = isTonight && h === hourNow;
          const pct = Math.max(v > 0 ? 4 : 1.5, (v / scale) * 100);
          const livePct = isNow && heat.level !== 'quiet' ? Math.min(100, heat.score * 100) : 0;
          return (
            <button
              key={h}
              type="button"
              aria-label={`${hourLong(h)}: about ${Math.round(v)} usually`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="relative flex-1 h-full flex items-end group"
            >
              <span
                className={`block w-full rounded-t-[4px] transition-colors ${
                  isNow ? 'bg-brand-400' : hover === i ? 'bg-brand-300/80' : 'bg-brand-500/45'
                }`}
                style={{ height: `${pct}%` }}
              />
              {/* Tonight's live level for the current hour, drawn as an outline over the usual bar. */}
              {livePct > 0 && (
                <span
                  className="absolute bottom-0 inset-x-0 rounded-t-[4px] border-2 border-b-0"
                  style={{ height: `${livePct}%`, borderColor: heat.color, boxShadow: `0 0 12px ${heat.color}` }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[2px] text-[10px] font-bold text-night-400">
        {series.map(({ h }) => (
          <span key={h} className="flex-1 text-center">
            {h % 3 === 0 ? hourLabel(h) : ''}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>Usual visitors by hour, {DAY_NAMES[night]} night</caption>
        <tbody>
          {series.map(({ h, v }) => (
            <tr key={h}>
              <th scope="row">{hourLong(h)}</th>
              <td>{v.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function levelOf(v: number, scale: number) {
  const s = v / scale;
  return s < 0.35 ? 'chill' : s < 0.7 ? 'lively' : 'packed';
}
