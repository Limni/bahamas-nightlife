import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, Loader2, Play, Radio as RadioIcon, Square, Volume2, VolumeX, X } from 'lucide-react';
import { stationColor, stationInitials, useRadio, type RadioStation } from '@/lib/radio';

// ---------------------------------------------------------------------------
// Live radio UI: an entry button ("Live radio"), the station picker and the
// mini-player that docks above the phone tab bar (bottom-right on desktop)
// and stays put across pages. Each station's brand colour is used only on its
// logo frame and its tile's edge, so the site theme stays in charge.
// ---------------------------------------------------------------------------

/** Equaliser bars: animated while playing, still under reduced motion. */
export function EqBars({ playing, className = '' }: { playing: boolean; className?: string }) {
  return (
    <span className={`eq-bars ${playing ? 'is-playing' : ''} ${className}`} aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function StationLogo({ station, className = 'w-12 h-12', textClass = 'text-[11px]' }: { station: RadioStation; className?: string; textClass?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const color = stationColor(station);
  const logo = station.logo_url && failed !== station.logo_url ? station.logo_url : null;
  return (
    <span
      className={`relative shrink-0 rounded-xl overflow-hidden flex items-center justify-center ${className}`}
      style={{ background: logo ? '#fff' : `linear-gradient(135deg, ${color}, ${color}88)`, boxShadow: `0 0 0 1.5px ${color}99` }}
    >
      {logo ? (
        <img src={logo} alt="" decoding="async" onError={() => setFailed(logo)} className="w-full h-full object-contain" />
      ) : (
        <span className={`font-display font-black text-white tracking-tight ${textClass}`}>{stationInitials(station.name)}</span>
      )}
    </span>
  );
}

/** Opens the picker. Hidden unless the admin has the radio on. */
export function RadioButton({ className = '' }: { className?: string }) {
  const { available, current, status, setPickerOpen } = useRadio();
  if (!available) return null;
  const on = !!current && (status === 'playing' || status === 'loading');
  return (
    <button type="button" onClick={() => setPickerOpen(true)} className={className} aria-haspopup="dialog">
      {on ? <EqBars playing={status === 'playing'} className="text-glow-300" /> : <RadioIcon className="w-4 h-4" />}
      <span className="truncate">{on ? current!.name : 'Live radio'}</span>
    </button>
  );
}

function StationState({ station }: { station: RadioStation }) {
  const { current, status, lastId } = useRadio();
  const mine = current?.id === station.id;
  if (mine && status === 'playing')
    return (
      <span className="inline-flex items-center gap-1.5 text-glow-300">
        <EqBars playing /> Playing · tap to stop
      </span>
    );
  if (mine && status === 'loading')
    return (
      <span className="inline-flex items-center gap-1.5 text-night-200">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Tuning in…
      </span>
    );
  if (mine && status === 'error')
    return (
      <span className="inline-flex items-center gap-1.5 text-amber-300">
        <AlertTriangle className="w-3.5 h-3.5" /> Off air · tap to retry
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-night-300">
      <Play className="w-3.5 h-3.5 fill-current" /> {lastId === station.id && !current ? 'Listen again' : 'Listen'}
    </span>
  );
}

/** The station picker: a sheet on phones, a dialog on desktop. */
export function RadioSheet() {
  const { available, pickerOpen, setPickerOpen, stations, current, nowPlaying, partner, partnerUrl, toggle } = useRadio();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [pickerOpen, setPickerOpen]);

  if (!available || !pickerOpen) return null;

  const pick = (s: RadioStation) => {
    const starting = current?.id !== s.id;
    toggle(s);
    // Starting a station hands over to the mini-player; stopping keeps the picker open.
    if (starting) setPickerOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[3000] flex items-end md:items-center justify-center md:p-6">
      <div className="radio-fade absolute inset-0 bg-night-950/70 backdrop-blur-sm" onClick={() => setPickerOpen(false)} />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="radio-title"
        className="radio-rise relative w-full md:max-w-lg max-h-[88dvh] overflow-y-auto outline-none rounded-t-3xl md:rounded-3xl bg-night-900 ring-1 ring-white/10 shadow-2xl px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-6"
      >
        <div className="md:hidden mx-auto mb-3 w-10 h-1 rounded-full bg-white/15" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="radio-title" className="text-lg font-extrabold text-white flex items-center gap-2">
              <RadioIcon className="w-5 h-5 text-brand-300" /> Live radio
            </h2>
            {partner && (
              <p className="mt-0.5 text-xs font-bold text-night-300">
                Presented by{' '}
                {partnerUrl ? (
                  <a href={partnerUrl} target="_blank" rel="noreferrer" className="text-night-100 hover:text-white underline-offset-2 hover:underline">
                    {partner}
                  </a>
                ) : (
                  <span className="text-night-100">{partner}</span>
                )}
              </p>
            )}
          </div>
          <button onClick={() => setPickerOpen(false)} className="p-2 -mr-1 rounded-full text-night-300 hover:text-white hover:bg-white/10" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className={`mt-4 grid gap-2.5 ${stations.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {stations.map((s) => {
            const mine = current?.id === s.id;
            const color = stationColor(s);
            const line = nowPlaying[s.id] ?? s.tagline;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => pick(s)}
                aria-pressed={mine}
                className={`min-w-0 text-left rounded-2xl p-3 bg-white/[0.04] hover:bg-white/[0.08] ring-1 transition-colors ${mine ? '' : 'ring-white/10'}`}
                style={mine ? { boxShadow: `0 0 0 1.5px ${color}, 0 0 22px -6px ${color}` } : undefined}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <StationLogo station={s} className="w-11 h-11" />
                  <span className="min-w-0">
                    <span className="block font-extrabold text-white text-sm leading-tight truncate">{s.name}</span>
                    {s.frequency && <span className="block text-[11px] font-bold text-night-300">{s.frequency}</span>}
                  </span>
                </span>
                <span className="mt-2 block text-xs font-semibold text-night-200 line-clamp-2 min-h-[2lh]">
                  {nowPlaying[s.id] && <span className="sr-only">Now playing: </span>}
                  {line ?? ' '}
                </span>
                <span className="mt-2 block text-[11px] font-extrabold">
                  <StationState station={s} />
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-[11px] font-semibold text-night-400">
          Streams live from the stations. Playing uses mobile data (roughly 30–60 MB an hour) and keeps going while you browse.
        </p>
      </div>
    </div>
  );
}

/** Height the docked player takes (plus gap), read by other floating bits so nothing overlaps. */
const DOCK_SPACE = '72px';

/** The mini-player. On the map it shrinks to a pill so it doesn't cover the controls. */
export function RadioDock() {
  const { current, status, nowPlaying, stop, resume, close, setPickerOpen, volume, setVolume } = useRadio();
  const { pathname } = useLocation();
  const onMap = pathname.startsWith('/map');
  const full = !!current && !onMap;

  useEffect(() => {
    document.documentElement.style.setProperty('--radio-dock', full ? DOCK_SPACE : '0px');
    return () => {
      document.documentElement.style.setProperty('--radio-dock', '0px');
    };
  }, [full]);

  if (!current) return null;

  const playing = status === 'playing';
  const busy = status === 'loading';
  const on = playing || busy;
  const track = nowPlaying[current.id];
  const playButton = (
    <button
      type="button"
      onClick={on ? stop : resume}
      className="shrink-0 w-10 h-10 rounded-full bg-brand-500 hover:bg-brand-400 text-white flex items-center justify-center glow-brand-soft"
      aria-label={on ? `Stop ${current.name}` : `Play ${current.name}`}
    >
      {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : on ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
    </button>
  );
  const closeButton = (
    <button type="button" onClick={close} className="shrink-0 p-1.5 rounded-full text-night-300 hover:text-white hover:bg-white/10" aria-label="Close the radio">
      <X className="w-4 h-4" />
    </button>
  );

  if (onMap) {
    return (
      <div
        className="fixed z-[1450] left-3 bottom-[calc(80px+env(safe-area-inset-bottom))] md:left-1/2 md:-translate-x-1/2 md:bottom-6 flex items-center gap-2 p-1.5 pr-1 rounded-full bg-night-900/95 backdrop-blur ring-1 ring-white/10 shadow-xl"
        role="region"
        aria-label="Live radio"
      >
        <button type="button" onClick={() => setPickerOpen(true)} className="flex items-center gap-2 pl-0.5" aria-label={`${current.name}: choose a station`}>
          <StationLogo station={current} className="w-9 h-9" textClass="text-[9px]" />
          <EqBars playing={playing} className="text-glow-300" />
        </button>
        {playButton}
        {closeButton}
      </div>
    );
  }

  return (
    <div
      className="fixed z-[1450] inset-x-3 bottom-[calc(72px+env(safe-area-inset-bottom))] md:inset-x-auto md:right-6 md:bottom-6 md:w-[420px] flex items-center gap-2.5 p-2 pr-1.5 rounded-2xl bg-night-900/95 backdrop-blur-md ring-1 ring-white/10 shadow-2xl"
      role="region"
      aria-label="Live radio"
    >
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="flex-1 min-w-0 flex items-center gap-2.5 text-left rounded-xl"
        aria-label={`${current.name}${track ? `, now playing ${track}` : ''}. Choose a station`}
      >
        <StationLogo station={current} className="w-11 h-11" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-extrabold text-white leading-tight">
            <span className="truncate">{current.name}</span>
            {playing && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-black tracking-wider text-brand-300">
                <span className="heat-dot pulse text-brand-400" /> LIVE
              </span>
            )}
          </span>
          <span className={`block text-xs font-semibold truncate ${status === 'error' ? 'text-amber-300' : 'text-night-300'}`}>
            {status === 'error'
              ? 'Off air right now · tap play to retry'
              : busy
                ? 'Tuning in…'
                : (track ?? current.tagline ?? current.frequency ?? 'Tap to change station')}
          </span>
        </span>
      </button>
      {/* Phones use their own volume buttons (iOS ignores page volume anyway). */}
      <span className="hidden md:flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setVolume(volume > 0 ? 0 : 1)}
          className="p-1.5 rounded-full text-night-300 hover:text-white hover:bg-white/10"
          aria-label={volume > 0 ? 'Mute' : 'Unmute'}
        >
          {volume > 0 ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="radio-volume w-14"
          aria-label="Volume"
        />
      </span>
      {playButton}
      {closeButton}
    </div>
  );
}
