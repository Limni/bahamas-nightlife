import { phoneHref } from '@/lib/phone';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useMotionValue, animate } from 'motion/react';
import { X, MapPin, Navigation, Phone, ChevronRight, Star, Clock, PartyPopper } from 'lucide-react';
import type { NightEvent, Venue } from '@/lib/types';
import { isFeatured } from '@/lib/types';
import { directionsUrl, formatDistance, getDistance } from '@/lib/geo';
import { dayLabel, hasHours, todayIndex } from '@/lib/hours';
import { useActivity } from '@/lib/activity';
import { eventWhen, isEventLive } from '@/lib/events';
import type { UserLocation } from '@/lib/directory';
import { HeatBadge, OpenBadge, Price, SafeImg } from './ui';

const HANDLE_H = 28; // px height of the grab-handle row
const MAX_VH = 0.8; // sheet never taller than this fraction of the viewport

/**
 * Map bottom sheet (same drag behaviour as Island GO's): drag the handle to
 * collapse to a peek of the pinned footer, expand, or fling down to dismiss.
 * `openKey` changes when the subject changes, re-measuring at full height.
 */
export function DraggableSheet({
  openKey,
  onClose,
  footer,
  children,
}: {
  openKey: string | null;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const height = useMotionValue(0);
  const expandedRef = useRef(0);
  const collapsedRef = useRef(0);
  const drag = useRef<{ startY: number; startH: number; lastY: number; lastT: number; v: number } | null>(null);

  const measure = () => {
    const maxH = Math.round(window.innerHeight * MAX_VH);
    const footerH = footerRef.current?.offsetHeight ?? 0;
    const contentH = contentRef.current?.scrollHeight ?? 0;
    const expanded = Math.min(HANDLE_H + contentH + footerH, maxH);
    const collapsed = Math.min(HANDLE_H + footerH, expanded);
    expandedRef.current = expanded;
    collapsedRef.current = collapsed;
    return { expanded, collapsed };
  };

  // Open (or switch subject) at full height, measured before paint to avoid a flash.
  useLayoutEffect(() => {
    if (!openKey) return;
    height.set(measure().expanded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  const snapTo = (h: number) => animate(height, h, { type: 'spring', damping: 30, stiffness: 300 });

  const onHandleDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { startY: e.clientY, startH: height.get(), lastY: e.clientY, lastT: performance.now(), v: 0 };
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    height.set(Math.max(0, Math.min(d.startH - (e.clientY - d.startY), expandedRef.current + 24)));
    const t = performance.now();
    const dt = t - d.lastT;
    if (dt > 0) d.v = ((e.clientY - d.lastY) / dt) * 1000; // px/s, positive = downward
    d.lastY = e.clientY;
    d.lastT = t;
  };
  const onHandleUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const h = height.get();
    const expanded = expandedRef.current;
    const collapsed = collapsedRef.current;
    if (d.v > 900 || h < collapsed - 60) return void onClose();
    if (expanded - collapsed <= 60) return void snapTo(expanded);
    if (d.v > 300) return void snapTo(collapsed);
    if (d.v < -300) return void snapTo(expanded);
    snapTo(h < (expanded + collapsed) / 2 ? collapsed : expanded);
  };

  return (
    <AnimatePresence>
      {openKey && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          style={{ height }}
          className="absolute bottom-0 left-0 right-0 z-[2000] bg-night-900/97 backdrop-blur-md rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden md:max-w-md md:left-4 md:right-auto md:bottom-4 md:rounded-3xl border border-white/10"
        >
          <div
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            className="flex justify-center pt-3 pb-2 shrink-0 cursor-grab active:cursor-grabbing touch-none"
          >
            <div className="w-12 h-1.5 bg-night-600 rounded-full" />
          </div>

          <button
            onClick={onClose}
            className="absolute top-3 right-4 p-2 bg-white/5 text-night-100 rounded-full hover:bg-white/10 transition-colors z-10"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>

          <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
            {children}
          </div>

          <div
            ref={footerRef}
            className="shrink-0 flex items-stretch gap-2 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-white/10"
          >
            {footer}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Footer tiles shared by the venue and event drawers. */
export function DirectionsTile({ lat, lng, location }: { lat: number; lng: number; location: UserLocation | null }) {
  const distance = location ? getDistance(location.lat, location.lng, lat, lng) : null;
  return (
    <a
      href={directionsUrl(lat, lng)}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col items-center justify-center px-3 rounded-2xl bg-sky-400/10 border border-sky-400/25 min-w-[76px] hover:border-sky-400/50"
      title="Directions"
    >
      <Navigation className="w-5 h-5 text-sky-300" />
      <span className="text-xs font-bold text-sky-200 mt-0.5">{distance !== null ? formatDistance(distance) : 'Go'}</span>
    </a>
  );
}

export const primaryAction =
  'flex-1 py-3 font-extrabold rounded-2xl flex items-center justify-center gap-1 text-base text-white bg-gradient-to-r from-brand-500 to-glow-500 hover:brightness-110 glow-brand';

export function VenueDrawer({
  venue,
  events,
  location,
  now,
  onClose,
  onEvent,
}: {
  venue: Venue | null;
  /** Upcoming events at this venue (soonest first). */
  events: NightEvent[];
  location: UserLocation | null;
  now: number;
  onClose: () => void;
  onEvent: (e: NightEvent) => void;
}) {
  const r = venue;
  const { heatOf, here } = useActivity();
  const heat = r ? heatOf(r.id) : null;
  const next = events[0];

  return (
    <DraggableSheet
      openKey={r?.id ?? null}
      onClose={onClose}
      footer={
        r && (
          <>
            {r.lat != null && r.lng != null && <DirectionsTile lat={r.lat} lng={r.lng} location={location} />}
            {r.phone && (
              <a
                href={phoneHref(r.phone)}
                className="flex flex-col items-center justify-center px-3 rounded-2xl bg-emerald-400/10 border border-emerald-400/25 min-w-[64px] hover:border-emerald-400/50"
                title={`Call ${r.phone}`}
              >
                <Phone className="w-5 h-5 text-emerald-400" />
                <span className="text-xs font-bold text-emerald-300 mt-0.5">Call</span>
              </a>
            )}
            <Link to={`/v/${r.slug}`} className={primaryAction}>
              Details & drinks <ChevronRight className="w-5 h-5" />
            </Link>
          </>
        )
      }
    >
      {r && heat && (
        <>
          <div className="flex items-start gap-4 mb-4 pr-10">
            <SafeImg src={r.cover_url} name={r.name} lazy={false} className="w-20 h-20 rounded-2xl border border-white/10 shrink-0" />
            <div className="min-w-0">
              {isFeatured(r, now) && (
                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-300 mb-1">
                  <Star className="w-3 h-3 fill-current" /> Featured
                </span>
              )}
              <h2 className="text-xl font-extrabold text-white leading-tight">{r.name}</h2>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-sm font-semibold text-night-200">
                <Price level={r.price_level} />
                {r.categories.length > 0 && <span className="truncate">{r.categories.join(' · ')}</span>}
              </div>
            </div>
          </div>

          {(heat.level !== 'quiet' || here === r.id) && (
            <div className="mb-3 px-3.5 py-2.5 rounded-2xl bg-white/5 border border-white/10">
              {heat.level !== 'quiet' ? <HeatBadge heat={heat} showUsual /> : <span className="text-xs font-bold text-night-300">Quiet right now</span>}
              {here === r.id && <p className="mt-1 text-xs font-bold text-brand-200">You’re here — you’re part of the count.</p>}
            </div>
          )}

          <div className="space-y-2 mb-4">
            <OpenBadge hours={r.hours} now={now} />
            {hasHours(r.hours) && (
              <p className="flex items-center gap-2 text-sm font-semibold text-night-100">
                <Clock className="w-4 h-4 text-brand-400" />
                Today: {dayLabel(r.hours[String(todayIndex(now))])}
              </p>
            )}
            {(r.address || r.area) && (
              <p className="flex items-start gap-2 text-sm font-semibold text-night-100">
                <MapPin className="w-4 h-4 text-brand-400 mt-0.5 shrink-0" />
                <span>{[r.address, r.area].filter(Boolean).join(' · ')}</span>
              </p>
            )}
          </div>

          {next && (
            <button
              onClick={() => onEvent(next)}
              className={`w-full mb-4 flex items-center gap-3 p-3 rounded-2xl text-left border transition-colors ${
                isEventLive(next, now) ? 'bg-brand-500/15 border-brand-400/40 hover:bg-brand-500/25' : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
            >
              <PartyPopper className="w-5 h-5 text-brand-300 shrink-0" />
              <span className="min-w-0">
                <span className="block text-[11px] font-extrabold uppercase tracking-wider text-brand-300">{eventWhen(next, now)}</span>
                <span className="block text-sm font-bold text-white truncate">{next.title}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-night-300 ml-auto shrink-0" />
            </button>
          )}

          {r.description && <p className="text-night-200 leading-relaxed mb-4 line-clamp-3">{r.description}</p>}

          {r.vibes.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {r.vibes.map((v) => (
                <span key={v} className="text-[10px] uppercase tracking-wider font-bold text-brand-200 bg-brand-500/10 px-2 py-0.5 rounded-full border border-brand-400/15">
                  {v}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </DraggableSheet>
  );
}
