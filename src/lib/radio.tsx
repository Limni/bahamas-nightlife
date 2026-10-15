import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase, supabaseConfigured } from './supabase';

// ---------------------------------------------------------------------------
// Live radio from a partner broadcaster. Strictly opt-in: nothing is created,
// buffered or downloaded until a visitor taps a station, and "pause" really
// stops the stream (a paused live stream keeps downloading and resumes
// minutes behind). One station plays at a time.
//
// The provider sits around the public <Layout/>, so playback survives route
// changes. The admin turns the player on in /admin/radio (site_settings).
// ---------------------------------------------------------------------------

export interface RadioStation {
  id: string;
  slug: string;
  name: string;
  frequency: string | null;
  tagline: string | null;
  stream_url: string | null;
  backup_url: string | null;
  meta_url: string | null;
  website: string | null;
  logo_url: string | null;
  logo_path: string | null;
  color: string | null;
  sort: number;
  is_enabled: boolean;
}

/** idle = no station in the dock; stopped = a station in the dock, not playing. */
export type RadioStatus = 'idle' | 'loading' | 'playing' | 'stopped' | 'error';

interface Config {
  enabled: boolean;
  partner: string | null;
  partnerUrl: string | null;
  stations: RadioStation[];
}

const CACHE_KEY = 'radio:v1';
const LAST_KEY = 'radio:last';
const VOLUME_KEY = 'radio:volume';
const PREVIEW_KEY = 'radio:preview';
const OFF: Config = { enabled: false, partner: null, partnerUrl: null, stations: [] };

function readPreview() {
  try {
    return sessionStorage.getItem(PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * "/?radio=preview" (the admin's "Preview on the site") shows the player in
 * this tab even while it's switched off, with every enabled station the
 * viewer can read: all of them for an admin (RLS), so stations without a
 * stream URL yet appear too. Visitors trying it only see ready stations.
 * "?radio=off" ends it. Call once before rendering, like initTheme().
 */
export function initRadioPreview() {
  const url = new URL(window.location.href);
  const param = url.searchParams.get('radio');
  if (param === null) return;
  try {
    if (param === 'preview') sessionStorage.setItem(PREVIEW_KEY, '1');
    else sessionStorage.removeItem(PREVIEW_KEY);
  } catch {
    /* private mode */
  }
  url.searchParams.delete('radio');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

/** Visitor-facing initials when a station has no logo yet: "100 Jamz" → "100", "Kiss FM" → "KISS". */
export function stationInitials(name: string) {
  const word = name.replace(/\bFM\b/i, '').trim().split(/\s+/)[0] ?? name;
  return word.slice(0, 4).toUpperCase();
}

export const stationColor = (s: Pick<RadioStation, 'color'>) => s.color ?? '#a855f7';

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

/** GA4 custom events (the partner's per-station listening report). No-op without gtag. */
function track(name: string, params: Record<string, unknown>) {
  try {
    (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag?.('event', name, params);
  } catch {
    /* blocked by an extension */
  }
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

export const isHls = (url: string) => /\.m3u8(\?|$)/i.test(url);

/**
 * Points an <audio> at a stream and returns its teardown. Plain MP3/AAC
 * (Icecast, Shoutcast) attach synchronously, so play() still runs inside the
 * tap (iOS requires it). HLS plays natively in Safari; elsewhere hls.js is
 * loaded on demand, only when someone picks an HLS station.
 */
export function attachStream(audio: HTMLAudioElement, url: string, onFatal: () => void): (() => void) | Promise<() => void> {
  const detach = () => {
    audio.removeAttribute('src');
    audio.load();
  };
  if (!isHls(url) || audio.canPlayType('application/vnd.apple.mpegurl')) {
    audio.src = url;
    return detach;
  }
  return import('hls.js/light').then(({ default: Hls }) => {
    if (!Hls.isSupported()) {
      audio.src = url; // let the browser try, and fail through the normal error path
      return detach;
    }
    const hls = new Hls({ liveDurationInfinity: true, maxBufferLength: 20 });
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) onFatal();
    });
    hls.loadSource(url);
    hls.attachMedia(audio);
    return () => {
      hls.destroy();
      detach();
    };
  });
}

// ---------------------------------------------------------------------------
// Now playing. Stations' hosts publish it in a few common shapes; anything we
// can't read (or a host that blocks cross-origin requests) just shows the
// station's tagline instead.
// ---------------------------------------------------------------------------

const KEEP_CAPS = new Set(['DJ', 'MC', 'FM', 'ID', 'UK', 'USA', 'II', 'III', 'R&B', 'TV']);

/** Many playout systems send ALL CAPS; "TARRUS RILEY – RED FLAGS" reads as shouting. */
function tidyCaps(s: string) {
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  return s
    .toLowerCase()
    .replace(/[^\s;,/&()-]+/g, (w) => (KEEP_CAPS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)));
}

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s || s.length > 160 || s === '-') return null;
  return tidyCaps(s);
}

function join(artist: unknown, title: unknown): string | null {
  const a = clean(artist);
  const t = clean(title);
  if (a && t) return t.toLowerCase().includes(a.toLowerCase()) ? t : `${a} – ${t}`;
  return t ?? null;
}

type Json = Record<string, unknown> | null | undefined;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);

function fromJson(input: unknown): string | null {
  const j = obj(Array.isArray(input) ? input[0] : input);
  if (!j) return null;
  // Icecast status-json.xsl
  const ice = obj(j.icestats);
  if (ice && ice.source) {
    const list = Array.isArray(ice.source) ? (ice.source as unknown[]) : [ice.source];
    const src = obj(list.find((s) => obj(s)?.title) ?? list[0]);
    return join(src?.artist, src?.title) ?? clean(src?.yp_currently_playing);
  }
  // AzuraCast
  const np = obj(j.now_playing);
  const song = obj(np?.song);
  if (song) return clean(song.text) ?? join(song.artist, song.title);
  if (typeof j.now_playing === 'string') return clean(j.now_playing);
  // Radio.co
  const track = obj(j.current_track);
  if (track) return clean(track.title);
  // Shoutcast v2 /stats?json=1
  if (typeof j.songtitle === 'string') return clean(j.songtitle);
  return join(j.artist, j.title) ?? clean(j.song) ?? clean(j.nowplaying);
}

function fromXml(text: string): string | null {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const first = (tag: string, root: Document | Element = doc) =>
    root.getElementsByTagName(tag)[0]?.textContent ?? root.getElementsByTagName(tag.toUpperCase())[0]?.textContent;
  // Shoutcast v1 (<SONGTITLE>), or a play history whose first <song>/<track> is the current one.
  const scTitle = first('songtitle');
  if (scTitle) return clean(scTitle);
  const item = doc.getElementsByTagName('song')[0] ?? doc.getElementsByTagName('track')[0] ?? doc.documentElement;
  return join(first('artist', item), first('title', item));
}

export function parseNowPlaying(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return fromJson(JSON.parse(t));
    } catch {
      return null;
    }
  }
  if (t.startsWith('<')) return /^<!doctype html|^<html/i.test(t) ? null : fromXml(t);
  return clean(t.split('\n')[0]); // plain text, e.g. Shoutcast /currentsong
}

export async function fetchNowPlaying(url: string, timeoutMs = 8000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return null;
    return parseNowPlaying(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface RadioState {
  /** The admin has the player on and at least one station has a stream (or this tab is previewing). */
  available: boolean;
  /** This tab is previewing the player ("/?radio=preview"). */
  preview: boolean;
  endPreview: () => void;
  partner: string | null;
  partnerUrl: string | null;
  stations: RadioStation[];
  current: RadioStation | null;
  status: RadioStatus;
  /** The station picked last time (this browser), offered first. */
  lastId: string | null;
  nowPlaying: Record<string, string>;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  /** Play this station, or stop it if it's the one playing. */
  toggle: (s: RadioStation) => void;
  play: (s: RadioStation) => void;
  stop: () => void;
  resume: () => void;
  /** Next/previous station (lock-screen skip buttons too). */
  skip: (dir: 1 | -1) => void;
  /** Stop and remove the mini-player. */
  close: () => void;
  volume: number;
  setVolume: (v: number) => void;
}

const RadioContext = createContext<RadioState | null>(null);

interface Playback {
  audio: HTMLAudioElement;
  detach: () => void;
}

const LISTEN_PING_MS = 5 * 60_000;

export function RadioProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState(readPreview);
  const [config, setConfig] = useState<Config>(() => (readPreview() ? OFF : readJson(CACHE_KEY, OFF)));
  const [current, setCurrent] = useState<RadioStation | null>(null);
  const [status, setStatus] = useState<RadioStatus>('idle');
  const [lastId, setLastId] = useState<string | null>(() => readJson<string | null>(LAST_KEY, null));
  const [nowPlaying, setNowPlaying] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [volume, setVolumeState] = useState(() => {
    const v = readJson<number>(VOLUME_KEY, 1);
    return typeof v === 'number' && v >= 0 && v <= 1 ? v : 1;
  });

  const pbRef = useRef<Playback | null>(null);
  const tokenRef = useRef(0);
  const volumeRef = useRef(volume);

  // ---- settings + stations -------------------------------------------------
  useEffect(() => {
    if (!supabaseConfigured) return;
    let alive = true;
    const load = async () => {
      // Missing columns/table (schema not re-run) = an error = no radio.
      const { data, error } = await supabase.from('site_settings').select('radio_enabled, radio_partner, radio_partner_url').maybeSingle();
      if (!alive) return;
      let next = OFF;
      if (!error && data && (data.radio_enabled || preview)) {
        const st = await supabase.from('radio_stations').select('*').order('sort').order('name');
        if (!alive) return;
        // RLS already hides incomplete stations from visitors; admins see them all.
        const stations = ((st.data ?? []) as RadioStation[]).filter((s) => s.is_enabled && (preview || s.stream_url));
        next = { enabled: true, partner: data.radio_partner ?? null, partnerUrl: data.radio_partner_url ?? null, stations };
      }
      setConfig(next);
      // A preview never becomes what this browser shows normally.
      if (!preview) writeStorage(CACHE_KEY, JSON.stringify(next));
    };
    load();
    // Switching the player off (or editing stations' partner line) reaches open tabs.
    const channel = supabase
      .channel('radio-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, () => load())
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [preview]);

  const endPreview = useCallback(() => {
    try {
      sessionStorage.removeItem(PREVIEW_KEY);
    } catch {
      /* private mode */
    }
    setPreview(false);
  }, []);

  const available = config.enabled && config.stations.length > 0;

  // ---- playback ------------------------------------------------------------
  const teardown = useCallback(() => {
    tokenRef.current++;
    const pb = pbRef.current;
    pbRef.current = null;
    if (pb) {
      pb.audio.pause();
      pb.detach();
    }
  }, []);

  const start = useCallback(
    (st: RadioStation, useBackup = false) => {
      teardown();
      const url = useBackup ? st.backup_url : st.stream_url;
      if (!url) {
        // Only reachable in a preview: show the station in the player, marked as having no stream.
        setCurrent(st);
        setStatus('error');
        return;
      }
      const token = tokenRef.current;
      const live = () => tokenRef.current === token;
      // A fresh element per play: a stale stream (or a slow hls.js import)
      // can never leak into the next station.
      const audio = new Audio();
      audio.preload = 'none';
      audio.volume = volumeRef.current;
      const pb: Playback = { audio, detach: () => {} };
      pbRef.current = pb;

      setCurrent(st);
      setStatus('loading');
      setLastId(st.id);
      writeStorage(LAST_KEY, JSON.stringify(st.id));

      const fail = () => {
        if (!live()) return;
        if (!useBackup && st.backup_url) return start(st, true);
        teardown();
        setStatus('error');
      };
      audio.addEventListener('playing', () => live() && setStatus('playing'));
      audio.addEventListener('waiting', () => live() && setStatus('loading'));
      audio.addEventListener('error', fail);
      // A live stream "ending" means the server dropped it.
      audio.addEventListener('ended', fail);

      const go = (detach: () => void) => {
        if (!live()) return detach();
        pb.detach = detach;
        audio.play().catch((e: { name?: string }) => {
          if (!live()) return;
          if (e?.name === 'NotAllowedError') {
            // Autoplay policy (e.g. the lock-screen play after a long pause): wait for a tap.
            teardown();
            setStatus('stopped');
          } else if (e?.name !== 'AbortError') fail();
        });
      };
      const attached = attachStream(audio, url, fail);
      if (typeof attached === 'function') go(attached);
      else attached.then(go, fail);

      if (!readPreview()) track('radio_play', { station: st.slug, station_name: st.name });
    },
    [teardown],
  );

  const stop = useCallback(() => {
    teardown();
    setStatus((s) => (s === 'idle' ? s : 'stopped'));
  }, [teardown]);

  const close = useCallback(() => {
    teardown();
    setCurrent(null);
    setStatus('idle');
  }, [teardown]);

  const resume = useCallback(() => {
    if (current) start(current);
  }, [current, start]);

  const toggle = useCallback(
    (st: RadioStation) => {
      if (current?.id === st.id && (status === 'playing' || status === 'loading')) stop();
      else start(st);
    },
    [current, status, start, stop],
  );

  const skip = useCallback(
    (dir: 1 | -1) => {
      const list = config.stations;
      if (!list.length) return;
      const i = current ? list.findIndex((s) => s.id === current.id) : -1;
      start(list[(i + dir + list.length) % list.length]);
    },
    [config.stations, current, start],
  );

  const setVolume = useCallback((v: number) => {
    volumeRef.current = v;
    setVolumeState(v);
    if (pbRef.current) pbRef.current.audio.volume = v;
    writeStorage(VOLUME_KEY, String(v));
  }, []);

  // Admin switched the player off, or removed the station that's playing.
  useEffect(() => {
    if (current && (!available || !config.stations.some((s) => s.id === current.id))) close();
  }, [available, config.stations, current, close]);

  // Leaving the public site (e.g. for /admin) unmounts the provider: stop the stream with it.
  useEffect(() => () => teardown(), [teardown]);

  // ---- now playing ---------------------------------------------------------
  // The picker shows every station's track; the mini-player only its own.
  // Nothing is fetched while the radio is closed and stopped.
  useEffect(() => {
    if (!available) return;
    const watched = pickerOpen
      ? config.stations.filter((s) => s.meta_url)
      : current?.meta_url && (status === 'playing' || status === 'loading')
        ? [current]
        : [];
    if (!watched.length) return;
    let alive = true;
    const poll = () => {
      if (document.hidden) return;
      for (const s of watched) {
        fetchNowPlaying(s.meta_url!).then((t) => {
          if (!alive) return;
          setNowPlaying((prev) => {
            if ((prev[s.id] ?? null) === t) return prev;
            const next = { ...prev };
            if (t) next[s.id] = t;
            else delete next[s.id];
            return next;
          });
        });
      }
    };
    poll();
    const id = setInterval(poll, pickerOpen ? 30_000 : 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [available, pickerOpen, config.stations, current, status]);

  // ---- listening-time heartbeat (GA4) ---------------------------------------
  useEffect(() => {
    if (status !== 'playing' || !current || preview) return;
    const id = setInterval(() => track('radio_listen', { station: current.slug, minutes: 5 }), LISTEN_PING_MS);
    return () => clearInterval(id);
  }, [status, current, preview]);

  // ---- lock screen / headset controls ---------------------------------------
  const latest = useRef({ resume, stop, skip });
  latest.current = { resume, stop, skip };

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, fn: (() => void) | null) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* action not supported here */
      }
    };
    set('play', () => latest.current.resume());
    set('pause', () => latest.current.stop());
    set('stop', () => latest.current.stop());
    const many = config.stations.length > 1;
    set('nexttrack', many ? () => latest.current.skip(1) : null);
    set('previoustrack', many ? () => latest.current.skip(-1) : null);
  }, [config.stations.length]);

  const currentTrack = current ? nowPlaying[current.id] : undefined;
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    if (!current) {
      ms.metadata = null;
      ms.playbackState = 'none';
      return;
    }
    ms.metadata = new MediaMetadata({
      title: currentTrack ?? current.name,
      artist: [current.name, current.frequency].filter(Boolean).join(' · '),
      album: config.partner ? `Live radio · ${config.partner}` : 'Nassau Nights live radio',
      artwork: current.logo_url
        ? [{ src: current.logo_url, sizes: '512x512' }]
        : [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    ms.playbackState = status === 'playing' || status === 'loading' ? 'playing' : 'paused';
  }, [current, status, currentTrack, config.partner]);

  const value = useMemo<RadioState>(
    () => ({
      available,
      preview,
      endPreview,
      partner: config.partner,
      partnerUrl: config.partnerUrl,
      stations: config.stations,
      current,
      status,
      lastId,
      nowPlaying,
      pickerOpen,
      setPickerOpen,
      toggle,
      play: start,
      stop,
      resume,
      skip,
      close,
      volume,
      setVolume,
    }),
    [available, preview, endPreview, config, current, status, lastId, nowPlaying, pickerOpen, toggle, start, stop, resume, skip, close, volume, setVolume],
  );

  return <RadioContext.Provider value={value}>{children}</RadioContext.Provider>;
}

export function useRadio() {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error('useRadio must be used inside <RadioProvider>');
  return ctx;
}
