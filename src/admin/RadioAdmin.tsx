import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Play, Plus, Radio as RadioIcon, Square, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { compressImage, deleteMedia, uploadBlob } from '@/lib/images';
import { attachStream, fetchNowPlaying, type RadioStation } from '@/lib/radio';
import { StationLogo } from '@/components/Radio';
import { Spinner } from '@/components/ui';
import { Button, Field, inputClass, Panel, Toggle, useFeedback } from './ui';

// ---------------------------------------------------------------------------
// /admin/radio: the partner broadcaster's stations and the master switch.
// Visitors only ever see enabled stations that have a stream URL (RLS), so a
// station can be set up here and tested before it shows up anywhere.
// ---------------------------------------------------------------------------

type Draft = Omit<RadioStation, 'id' | 'slug' | 'sort' | 'logo_url' | 'logo_path'>;

const EMPTY: Draft = {
  name: '',
  frequency: null,
  tagline: null,
  stream_url: null,
  backup_url: null,
  meta_url: null,
  website: null,
  color: '#a855f7',
  is_enabled: true,
};

const MISSING_SCHEMA = 'The radio isn’t in the database yet. Re-run supabase/schema.sql.';
const isSchemaError = (e: { code?: string; message: string }) => e.code === '42P01' || e.code === '42703' || /radio/.test(e.message);

const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'station';

const pickDraft = (s: RadioStation): Draft =>
  Object.fromEntries((Object.keys(EMPTY) as (keyof Draft)[]).map((k) => [k, s[k] ?? EMPTY[k]])) as unknown as Draft;

const blank = (v: string) => (v.trim() ? v.trim() : null);

/** Problems the database would reject, in words an admin can act on. */
function problems(d: Draft): string | null {
  if (!d.name.trim()) return 'Give the station a name.';
  for (const [label, v] of [
    ['Stream URL', d.stream_url],
    ['Backup stream', d.backup_url],
    ['Now-playing URL', d.meta_url],
  ] as const) {
    if (v && !/^https:\/\//i.test(v)) {
      return `${label} must start with https://. An http:// stream can’t play on an https site; ask the station for their secure address.`;
    }
  }
  if (d.website && !/^https?:\/\//i.test(d.website)) return 'Website must start with https://';
  if (d.color && !/^#[0-9a-f]{6}$/i.test(d.color)) return 'Colour must be like #ff3366.';
  return null;
}

/** One shared test player for the console: a single stream at a time. */
function useTestPlayer() {
  const ref = useRef<{ audio: HTMLAudioElement; detach: () => void } | null>(null);
  const [testing, setTesting] = useState<{ key: string; state: 'loading' | 'playing' } | null>(null);
  const { toast } = useFeedback();

  const stop = () => {
    const cur = ref.current;
    ref.current = null;
    if (cur) {
      cur.audio.pause();
      cur.detach();
    }
    setTesting(null);
  };

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const play = (key: string, url: string) => {
    stop();
    const audio = new Audio();
    audio.preload = 'none';
    const entry = { audio, detach: () => {} };
    ref.current = entry;
    setTesting({ key, state: 'loading' });
    const mine = () => ref.current === entry;
    const fail = (why?: string) => {
      if (!mine()) return;
      stop();
      toast(why ?? 'That stream didn’t play. Check the URL, or ask the station for a direct MP3/AAC or HLS (.m3u8) link.', 'error');
    };
    audio.addEventListener('playing', () => mine() && setTesting({ key, state: 'playing' }));
    audio.addEventListener('error', () => fail());
    const go = (detach: () => void) => {
      if (!mine()) return detach();
      entry.detach = detach;
      audio.play().catch((e: { name?: string; message?: string }) => e?.name !== 'AbortError' && fail());
    };
    const attached = attachStream(audio, url, () => fail());
    if (typeof attached === 'function') go(attached);
    else attached.then(go, () => fail());
  };

  return { testing, play, stop };
}

function StationForm({
  station,
  onSaved,
  onDeleted,
  onCancel,
  test,
}: {
  station: RadioStation | null;
  onSaved: (s: RadioStation) => void;
  onDeleted?: () => void;
  onCancel?: () => void;
  test: ReturnType<typeof useTestPlayer>;
}) {
  const { toast, confirm } = useFeedback();
  // Only the editable fields: the logo is saved on its own, and a stale copy must never overwrite it.
  const [d, setD] = useState<Draft>(() => (station ? pickDraft(station) : EMPTY));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [metaResult, setMetaResult] = useState<string | null>(null);
  const [checkingMeta, setCheckingMeta] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const key = station?.id ?? 'new';
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const text = (k: 'frequency' | 'tagline' | 'stream_url' | 'backup_url' | 'meta_url' | 'website') => ({
    value: d[k] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value || null),
  });

  const save = async () => {
    const clean: Draft = {
      ...d,
      name: d.name.trim(),
      frequency: blank(d.frequency ?? ''),
      tagline: blank(d.tagline ?? ''),
      stream_url: blank(d.stream_url ?? ''),
      backup_url: blank(d.backup_url ?? ''),
      meta_url: blank(d.meta_url ?? ''),
      website: blank(d.website ?? ''),
    };
    const why = problems(clean);
    if (why) return toast(why, 'error');
    setSaving(true);
    let res;
    if (station) {
      res = await supabase.from('radio_stations').update(clean).eq('id', station.id).select().single();
    } else {
      const { data: last } = await supabase.from('radio_stations').select('sort').order('sort', { ascending: false }).limit(1);
      const sort = (last?.[0]?.sort ?? 0) + 1;
      res = await supabase.from('radio_stations').insert({ ...clean, slug: slugify(clean.name), sort }).select().single();
      // Slugs are stable ids (analytics, "last station"); a clash just gets a suffix.
      if (res.error?.code === '23505') {
        res = await supabase
          .from('radio_stations')
          .insert({ ...clean, slug: `${slugify(clean.name).slice(0, 27)}-${Math.random().toString(36).slice(2, 6)}`, sort })
          .select()
          .single();
      }
    }
    setSaving(false);
    if (res.error) return toast(isSchemaError(res.error) ? MISSING_SCHEMA : res.error.message, 'error');
    toast(station ? 'Station saved' : 'Station added');
    onSaved(res.data as RadioStation);
  };

  const uploadLogo = async (file: File) => {
    if (!station) return;
    setUploading(true);
    try {
      const blob = await compressImage(file, 512);
      const up = await uploadBlob(blob.type ? blob : new Blob([blob], { type: file.type }), `radio/${station.id}`, file.name);
      const { data, error } = await supabase
        .from('radio_stations')
        .update({ logo_url: up.url, logo_path: up.path })
        .eq('id', station.id)
        .select()
        .single();
      if (error) {
        await deleteMedia(up.path);
        throw error;
      }
      await deleteMedia(station.logo_path);
      onSaved(data as RadioStation);
      toast('Logo updated');
    } catch (e) {
      toast((e as Error).message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    if (!station || (!station.logo_path && !station.logo_url)) return;
    const { data, error } = await supabase.from('radio_stations').update({ logo_url: null, logo_path: null }).eq('id', station.id).select().single();
    if (error) return toast(error.message, 'error');
    await deleteMedia(station.logo_path);
    onSaved(data as RadioStation);
  };

  const remove = async () => {
    if (!station) return;
    const ok = await confirm({ title: `Delete ${station.name}?`, body: 'It disappears from the player straight away.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    if (test.testing?.key.startsWith(station.id)) test.stop();
    const { error } = await supabase.from('radio_stations').delete().eq('id', station.id);
    if (error) return toast(error.message, 'error');
    await deleteMedia(station.logo_path);
    toast('Station deleted');
    onDeleted?.();
  };

  const checkMeta = async () => {
    if (!d.meta_url) return;
    setCheckingMeta(true);
    setMetaResult(null);
    const t = await fetchNowPlaying(d.meta_url.trim());
    setCheckingMeta(false);
    setMetaResult(t ? `Now playing: ${t}` : 'Couldn’t read a track from that URL. It may block requests from other sites; ask the station’s host or send it to us.');
  };

  const testButton = (which: 'main' | 'backup', url: string | null) => {
    const k = `${key}:${which}`;
    const active = test.testing?.key === k;
    return (
      <Button variant="secondary" disabled={!url} onClick={() => (active ? test.stop() : url && test.play(k, url.trim()))} className="shrink-0">
        {active ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4" />}
        {active ? (test.testing?.state === 'playing' ? 'Playing · stop' : 'Connecting…') : 'Test'}
      </Button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name">
          <input className={inputClass} value={d.name} maxLength={40} onChange={(e) => set('name', e.target.value)} placeholder="100 Jamz" />
        </Field>
        <Field label="Frequency">
          <input className={inputClass} {...text('frequency')} maxLength={20} placeholder="100.3 FM" />
        </Field>
      </div>
      <Field label="Genre line" hint="Shown under the name when there’s no now-playing info.">
        <input className={inputClass} {...text('tagline')} maxLength={80} placeholder="R&B, hip-hop, reggae & soca" />
      </Field>
      <Field label="Stream URL" hint="The direct HTTPS audio stream (MP3/AAC from Icecast or Shoutcast, or an HLS .m3u8), not the station’s web player page.">
        <div className="flex gap-2">
          <input className={inputClass} {...text('stream_url')} inputMode="url" placeholder="https://…" />
          {testButton('main', d.stream_url)}
        </div>
      </Field>
      <Field label="Backup stream (optional)" hint="Tried once if the main stream fails.">
        <div className="flex gap-2">
          <input className={inputClass} {...text('backup_url')} inputMode="url" placeholder="https://…" />
          {testButton('backup', d.backup_url)}
        </div>
      </Field>
      <Field label="Now-playing URL (optional)" hint="Icecast status-json.xsl, Shoutcast stats, AzuraCast / Radio.co API, a play-history XML or plain text.">
        <div className="flex gap-2">
          <input className={inputClass} {...text('meta_url')} inputMode="url" placeholder="https://…/status-json.xsl" />
          <Button variant="secondary" disabled={!d.meta_url} loading={checkingMeta} onClick={checkMeta} className="shrink-0">
            Check
          </Button>
        </div>
        {metaResult && <span className="block mt-1.5 text-xs font-bold text-slate-600 break-words">{metaResult}</span>}
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
        <Field label="Station website (optional)">
          <input className={inputClass} {...text('website')} inputMode="url" placeholder="https://…" />
        </Field>
        <Field label="Brand colour">
          <span className="flex items-center gap-2">
            <input
              type="color"
              value={d.color ?? '#a855f7'}
              onChange={(e) => set('color', e.target.value)}
              className="w-12 h-[46px] rounded-xl border border-slate-200 bg-white p-1 cursor-pointer"
              aria-label="Brand colour"
            />
            <input className={`${inputClass} w-28`} value={d.color ?? ''} maxLength={7} onChange={(e) => set('color', e.target.value || null)} placeholder="#a855f7" />
          </span>
        </Field>
      </div>

      {station ? (
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-slate-900 p-2">
            <StationLogo station={{ ...station, color: d.color }} className="w-14 h-14" />
          </span>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
              <ImagePlus className="w-4 h-4" /> {station.logo_url ? 'Replace logo' : 'Add logo'}
            </Button>
            {station.logo_url && (
              <Button variant="ghost" onClick={removeLogo}>
                Remove
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) uploadLogo(f);
            }}
          />
        </div>
      ) : (
        <p className="text-xs font-semibold text-slate-500">Add a logo after the first save.</p>
      )}

      <Toggle checked={d.is_enabled} onChange={(v) => set('is_enabled', v)} label="Enabled" hint="Off hides this station from the player without deleting it." />

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button onClick={save} loading={saving}>
          {station ? 'Save station' : 'Add station'}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {station && (
          <Button variant="ghost" onClick={remove} className="ml-auto text-rose-600 hover:bg-rose-50">
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function statusOf(s: RadioStation) {
  if (!s.is_enabled) return { label: 'Off', cls: 'bg-slate-100 text-slate-600' };
  if (!s.stream_url) return { label: 'Needs stream URL', cls: 'bg-amber-50 text-amber-700' };
  return { label: 'Ready', cls: 'bg-emerald-50 text-emerald-700' };
}

export default function RadioAdmin() {
  const { toast } = useFeedback();
  const test = useTestPlayer();
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [partner, setPartner] = useState('');
  const [partnerUrl, setPartnerUrl] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('site_settings').select('radio_enabled, radio_partner, radio_partner_url').maybeSingle(),
      supabase.from('radio_stations').select('*').order('sort').order('name'),
    ]).then(([s, st]) => {
      setLoading(false);
      if (s.error || st.error) {
        setMissing(true);
        return;
      }
      setEnabled(!!s.data?.radio_enabled);
      setPartner(s.data?.radio_partner ?? '');
      setPartnerUrl(s.data?.radio_partner_url ?? '');
      setStations((st.data ?? []) as RadioStation[]);
    });
  }, []);

  const ready = stations.filter((s) => s.is_enabled && s.stream_url).length;

  const saveSettings = async (nextEnabled = enabled) => {
    const url = partnerUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) return toast('Partner link must start with https://', 'error');
    setSavingSettings(true);
    const { data, error } = await supabase
      .from('site_settings')
      .update({ radio_enabled: nextEnabled, radio_partner: partner.trim() || null, radio_partner_url: url || null })
      .eq('id', true)
      .select('radio_enabled');
    setSavingSettings(false);
    if (error) return toast(isSchemaError(error) ? MISSING_SCHEMA : error.message, 'error');
    if (!data?.length) return toast('Nothing was saved. Re-run supabase/schema.sql to create the settings row.', 'error');
    setEnabled(nextEnabled);
    toast(nextEnabled ? (ready ? 'The radio is live on the site' : 'Saved. The player appears once a station has a stream URL') : 'Saved');
  };

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stations.length) return;
    const next = [...stations];
    [next[i], next[j]] = [next[j], next[i]];
    const renumbered = next.map((s, k) => ({ ...s, sort: k + 1 }));
    setStations(renumbered);
    const changed = renumbered.filter((s, k) => s.sort !== stations[k]?.sort || s.id !== stations[k]?.id);
    const results = await Promise.all(changed.map((s) => supabase.from('radio_stations').update({ sort: s.sort }).eq('id', s.id)));
    const err = results.find((r) => r.error)?.error;
    if (err) toast(err.message, 'error');
  };

  const upsertLocal = (s: RadioStation) =>
    setStations((list) => (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s]));

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Spinner className="w-7 h-7" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Live radio</h1>
        <p className="text-sm font-semibold text-slate-500">
          A mini-player for our radio partner’s stations. Nothing plays until a visitor taps a station, and it keeps playing while they browse.
        </p>
      </div>

      {missing ? (
        <Panel title="Set up needed">
          <p className="text-sm font-semibold text-slate-600">{MISSING_SCHEMA}</p>
        </Panel>
      ) : (
        <>
          <Panel title="Player">
            <div className="space-y-4">
              <Toggle
                checked={enabled}
                onChange={(v) => saveSettings(v)}
                label="Show the radio player"
                hint={
                  ready
                    ? `${ready} station${ready === 1 ? '' : 's'} ready. Saves straight away.`
                    : 'No station has a stream URL yet, so visitors won’t see it even when on.'
                }
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Presented by" hint="The partner’s name, shown in the player.">
                  <input className={inputClass} value={partner} maxLength={80} onChange={(e) => setPartner(e.target.value)} placeholder="Broadcaster name" />
                </Field>
                <Field label="Partner link (optional)">
                  <input className={inputClass} value={partnerUrl} inputMode="url" onChange={(e) => setPartnerUrl(e.target.value)} placeholder="https://…" />
                </Field>
              </div>
              <Button variant="secondary" loading={savingSettings} onClick={() => saveSettings()}>
                Save partner details
              </Button>
            </div>
          </Panel>

          <Panel
            title="Stations"
            action={
              !adding && (
                <Button variant="secondary" onClick={() => setAdding(true)} className="py-1.5">
                  <Plus className="w-4 h-4" /> Add
                </Button>
              )
            }
          >
            <div className="space-y-2.5">
              {adding && (
                <div className="rounded-2xl border border-brand-200 bg-brand-50/30 p-4">
                  <StationForm
                    station={null}
                    test={test}
                    onCancel={() => setAdding(false)}
                    onSaved={(s) => {
                      upsertLocal(s);
                      setAdding(false);
                      setOpenId(s.id);
                    }}
                  />
                </div>
              )}
              {stations.length === 0 && !adding && <p className="text-sm font-semibold text-slate-500">No stations yet.</p>}
              {stations.map((s, i) => {
                const st = statusOf(s);
                const open = openId === s.id;
                return (
                  <div key={s.id} className={`rounded-2xl border ${open ? 'border-slate-300' : 'border-slate-200'}`}>
                    <div className="flex items-center gap-3 p-2.5">
                      <button type="button" onClick={() => setOpenId(open ? null : s.id)} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                        <span className="rounded-xl bg-slate-900 p-1">
                          <StationLogo station={s} className="w-10 h-10" />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-extrabold text-slate-900 truncate">{s.name}</span>
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-slate-500">
                            {s.frequency && <span>{s.frequency}</span>}
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold ${st.cls}`}>{st.label}</span>
                          </span>
                        </span>
                      </button>
                      <span className="flex shrink-0">
                        <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label={`Move ${s.name} up`}>
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={i === stations.length - 1}
                          onClick={() => move(i, 1)}
                          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                          aria-label={`Move ${s.name} down`}
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                      </span>
                    </div>
                    {open && (
                      <div className="border-t border-slate-100 p-4">
                        <StationForm
                          key={s.id}
                          station={s}
                          test={test}
                          onSaved={upsertLocal}
                          onDeleted={() => {
                            setStations((list) => list.filter((x) => x.id !== s.id));
                            setOpenId(null);
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="What to ask the station for">
            <ul className="text-sm font-semibold text-slate-600 space-y-1.5 list-disc pl-5">
              <li>The direct HTTPS stream address for each station (not the web player page) and its format: MP3, AAC or HLS.</li>
              <li>A now-playing feed (their streaming host usually has one), allowed for requests from our site.</li>
              <li>A square logo per station, and written permission to play the streams here.</li>
            </ul>
            <p className="mt-3 flex items-start gap-2 text-xs font-semibold text-slate-500">
              <RadioIcon className="w-4 h-4 shrink-0" /> Listening is counted per station in Google Analytics (events radio_play and radio_listen, every 5 minutes of
              listening), for the partner’s reports.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
