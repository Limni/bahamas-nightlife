import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, ExternalLink, ImagePlus, Loader2, Repeat, Save, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useDirectory } from '@/lib/directory';
import { deleteMedia, uploadMedia } from '@/lib/images';
import { dayLabel, DAY_NAMES, hasHours, type WeeklyHours } from '@/lib/hours';
import { recurrenceLabel } from '@/lib/events';
import type { NightEvent, Venue } from '@/lib/types';
import { Spinner } from '@/components/ui';
import { Button, Field, inputClass, Panel, Toggle, useFeedback } from './ui';
import { LocationField, type LatLng } from './LocationField';
import { HoursEditor } from './HoursEditor';

// ---------------------------------------------------------------------------
// Event times are entered as Nassau wall-clock time, whatever timezone the
// admin's phone is in (a promoter abroad, a laptop set to UTC…).
// ---------------------------------------------------------------------------

/** Minutes to add to UTC to get Nassau local time at instant t (−300 EST / −240 EDT). */
function nassauOffsetMin(t: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Nassau',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t) / 60000);
}

/** ISO instant → "YYYY-MM-DDTHH:mm" in Nassau (for <input type="datetime-local">). */
export function toNassauInput(iso: string | null | undefined) {
  if (!iso) return '';
  const t = Date.parse(iso);
  return new Date(t + nassauOffsetMin(t) * 60000).toISOString().slice(0, 16);
}

/** "YYYY-MM-DDTHH:mm" in Nassau → ISO instant. */
export function fromNassauInput(local: string) {
  const [d, tm] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = tm.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, da, h, mi);
  // Two passes settle the offset across a DST change.
  let t = naive - nassauOffsetMin(naive) * 60000;
  t = naive - nassauOffsetMin(t) * 60000;
  return new Date(t).toISOString();
}

/** A preset night: `daysAhead` from today (Nassau), start hour → end hour (next day if earlier). */
function presetNight(daysAhead: number, startH: number, endH: number) {
  const today = toNassauInput(new Date().toISOString()).slice(0, 10);
  const base = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) + daysAhead * 86_400_000;
  const day = (offset: number) => new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return { start: `${day(0)}T${hh(startH)}`, end: `${day(endH <= startH ? 1 : 0)}T${hh(endH)}` };
}

function daysUntil(dow: number) {
  const today = new Date(toNassauInput(new Date().toISOString()) + 'Z').getUTCDay();
  return (dow - today + 7) % 7;
}

const todayNassau = () => toNassauInput(new Date().toISOString()).slice(0, 10);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (date: string) => new Date(`${date}T12:00Z`).getUTCDay();

// A weekly run is stored as start = 6 AM on its first night and end = 6 AM
// after its last night, so the small hours of an overnight session still count
// and the night before the first one doesn't (see isEventInDateRange).
const DAY_EDGE = 'T06:00';
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

interface Form {
  title: string;
  description: string;
  venue_id: string;
  own_location: boolean;
  location: LatLng | null;
  address: string;
  /** 'once': start..end. 'weekly': the chosen nights every week, from first_night. */
  repeat: 'once' | 'weekly';
  start: string;
  end: string;
  /** Weekly: same time on every chosen night (days + open/close), or per-night `hours`. */
  custom_times: boolean;
  days: number[];
  open: string;
  close: string;
  hours: WeeklyHours;
  first_night: string;
  /** Weekly with no end date: runs until an admin ends or deletes it. */
  no_end: boolean;
  last_night: string;
  price_note: string;
  ticket_url: string;
  is_published: boolean;
  is_featured: boolean;
}

function weeklyFields(e: NightEvent) {
  const hours = e.hours ?? {};
  const keys = Object.keys(hours);
  const first = keys.length ? hours[keys[0]] : null;
  const uniform = keys.every((k) => hours[k].open === first?.open && hours[k].close === first?.close);
  // end is 6 AM after the last night; stepping back 12 h lands on that night.
  const lastNight = e.end_date ? toNassauInput(new Date(Date.parse(e.end_date) - 43_200_000).toISOString()).slice(0, 10) : '';
  return {
    custom_times: !uniform,
    days: keys.map(Number),
    open: first?.open ?? '22:00',
    close: first?.close ?? '02:00',
    hours,
    first_night: toNassauInput(e.start_date).slice(0, 10),
    no_end: !e.end_date,
    last_night: lastNight,
  };
}

const toForm = (e: NightEvent): Form => ({
  title: e.title,
  description: e.description ?? '',
  venue_id: e.venue_id ?? '',
  own_location: e.lat != null && e.lng != null,
  location: e.lat != null && e.lng != null ? { lat: e.lat, lng: e.lng } : null,
  address: e.address ?? '',
  repeat: hasHours(e.hours) ? 'weekly' : 'once',
  start: toNassauInput(e.start_date),
  end: toNassauInput(e.end_date),
  ...weeklyFields(e),
  price_note: e.price_note ?? '',
  ticket_url: e.ticket_url ?? '',
  is_published: e.is_published,
  is_featured: e.is_featured,
});

const blank = (venueId: string, notes = ''): Form => {
  const tonight = presetNight(0, 22, 2);
  return {
    title: '',
    description: notes,
    venue_id: venueId,
    own_location: !venueId,
    location: null,
    address: '',
    repeat: 'once',
    start: tonight.start,
    end: tonight.end,
    custom_times: false,
    days: [],
    open: '22:00',
    close: '02:00',
    hours: {},
    first_night: todayNassau(),
    no_end: true,
    last_night: '',
    price_note: '',
    ticket_url: '',
    is_published: true,
    is_featured: false,
  };
};

const orNull = (s: string) => s.trim() || null;

/** The weekly windows a weekly form describes. */
function weeklyHours(f: Form): WeeklyHours {
  if (f.custom_times) return f.hours;
  return Object.fromEntries(f.days.map((d) => [String(d), { open: f.open, close: f.close }]));
}

const shortDate = (date: string) =>
  new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

const chipClass = (on: boolean) =>
  `px-3 py-1.5 rounded-full text-xs font-extrabold ${on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-brand-50 hover:text-brand-700'}`;

/** "/admin/events/new" (optionally ?venue=<id>&notes=<text>, e.g. from an Inbox tip) and "/admin/events/:id". Keyed so switching events starts fresh. */
export default function EventEditorRoute() {
  const { id } = useParams();
  return <EventEditor key={id ?? 'new'} />;
}

function EventEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useDirectory();
  const { toast, confirm } = useFeedback();
  const [event, setEvent] = useState<NightEvent | null>(null);
  const [form, setForm] = useState<Form | null>(isNew ? blank(params.get('venue') ?? '', params.get('notes') ?? '') : null);
  const [saved, setSaved] = useState<Form | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [missing, setMissing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // All venues, drafts included: an event can be prepared before its spot goes live.
    supabase
      .from('venues')
      .select('*')
      .order('name')
      .then(({ data }) => setVenues((data as Venue[]) ?? []));
  }, []);

  useEffect(() => {
    if (isNew) return;
    supabase
      .from('events')
      .select('*')
      .eq('id', id!)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return setMissing(true);
        setEvent(data as NightEvent);
        setForm(toForm(data as NightEvent));
        setSaved(toForm(data as NightEvent));
      });
  }, [id, isNew]);

  const dirty = useMemo(() => !isNew && JSON.stringify(form) !== JSON.stringify(saved), [form, saved, isNew]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  if (missing) {
    return (
      <div className="text-center py-16">
        <p className="font-extrabold text-slate-700">That event doesn’t exist (or was deleted).</p>
        <Link to="/admin/events" className="text-brand-600 font-bold">Back to events</Link>
      </div>
    );
  }
  if (!form) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const venue = venues.find((v) => v.id === form.venue_id);

  const save = async () => {
    if (!form.title.trim()) return toast('Give the event a title', 'error');
    let start: string;
    let end: string | null;
    let hours: WeeklyHours | null = null;
    if (form.repeat === 'weekly') {
      hours = weeklyHours(form);
      if (!hasHours(hours)) return toast('Pick at least one night of the week', 'error');
      if (!form.first_night) return toast('Set the first night', 'error');
      if (!form.no_end && !form.last_night) return toast('Set the last night, or turn on “No end date”', 'error');
      if (!form.no_end && form.last_night < form.first_night) return toast('The last night is before the first', 'error');
      start = fromNassauInput(form.first_night + DAY_EDGE);
      end = form.no_end ? null : fromNassauInput(addDays(form.last_night, 1) + DAY_EDGE);
    } else {
      if (!form.start || !form.end) return toast('Set a start and end time', 'error');
      start = fromNassauInput(form.start);
      end = fromNassauInput(form.end);
      if (end < start) return toast('The end is before the start', 'error');
    }
    if (form.own_location ? !form.location : !form.venue_id) {
      const ok = await confirm({
        title: 'Save without a location?',
        body: 'It will be listed on the Events page but won’t appear on the map.',
        confirmLabel: 'Save anyway',
      });
      if (!ok) return;
    }
    setSaving(true);
    const row = {
      title: form.title.trim(),
      description: orNull(form.description),
      venue_id: form.venue_id || null,
      lat: form.own_location ? (form.location?.lat ?? null) : null,
      lng: form.own_location ? (form.location?.lng ?? null) : null,
      address: form.own_location ? orNull(form.address) : null,
      start_date: start,
      end_date: end,
      hours,
      price_note: orNull(form.price_note),
      ticket_url: orNull(form.ticket_url),
      is_published: form.is_published,
      is_featured: form.is_featured,
    };
    const { data, error } = isNew
      ? await supabase.from('events').insert(row).select('*').single()
      : await supabase.from('events').update(row).eq('id', event!.id).select('*').single();
    setSaving(false);
    if (error) return toast(error.message, 'error');
    refresh();
    toast(isNew ? 'Event created' : 'Saved');
    if (isNew) return navigate(`/admin/events/${(data as NightEvent).id}`, { replace: true });
    setEvent(data as NightEvent);
    setForm(toForm(data as NightEvent));
    setSaved(toForm(data as NightEvent));
  };

  const uploadImage = async (file: File) => {
    if (!event) return;
    setUploading(true);
    try {
      const { url, path } = await uploadMedia(file, `events/${event.id}`);
      const { error } = await supabase.from('events').update({ image_url: url, image_path: path }).eq('id', event.id);
      if (error) throw error;
      await deleteMedia(event.image_path);
      setEvent({ ...event, image_url: url, image_path: path });
      refresh();
      toast('Flyer updated');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async () => {
    if (!event?.image_url) return;
    const { error } = await supabase.from('events').update({ image_url: null, image_path: null }).eq('id', event.id);
    if (error) return toast(error.message, 'error');
    await deleteMedia(event.image_path);
    setEvent({ ...event, image_url: null, image_path: null });
    refresh();
  };

  const remove = async () => {
    if (!event) return;
    const ok = await confirm({ title: `Delete “${event.title}”?`, body: 'This can’t be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('events').delete().eq('id', event.id);
    if (error) return toast(error.message, 'error');
    await deleteMedia(event.image_path);
    refresh();
    toast('Deleted');
    navigate('/admin/events', { replace: true });
  };

  const setRepeat = (repeat: Form['repeat']) =>
    setForm((f) => {
      if (!f || f.repeat === repeat) return f;
      // Going weekly from a one-off: carry its night and times over.
      if (repeat === 'weekly' && !hasHours(weeklyHours(f)) && f.start && f.end) {
        const night = f.start.slice(0, 10);
        return { ...f, repeat, custom_times: false, days: [weekdayOf(night)], open: f.start.slice(11, 16), close: f.end.slice(11, 16), first_night: night };
      }
      return { ...f, repeat };
    });

  const toggleCustomTimes = (custom: boolean) =>
    setForm((f) => {
      if (!f) return f;
      if (custom) return { ...f, custom_times: true, hours: weeklyHours(f) };
      const keys = Object.keys(f.hours);
      const first = keys.length ? f.hours[keys[0]] : null;
      return { ...f, custom_times: false, days: keys.map(Number), open: first?.open ?? f.open, close: first?.close ?? f.close };
    });

  const weeklyPresets: [string, Pick<Form, 'days' | 'open' | 'close'>][] = [
    ['Every Fri 10 PM–2 AM', { days: [5], open: '22:00', close: '02:00' }],
    ['Every Sat 10 PM–3 AM', { days: [6], open: '22:00', close: '03:00' }],
    ['Fri & Sat 10 PM–3 AM', { days: [5, 6], open: '22:00', close: '03:00' }],
    ['Every Thu 9 PM–1 AM', { days: [4], open: '21:00', close: '01:00' }],
    ['Every Sun 4–9 PM', { days: [0], open: '16:00', close: '21:00' }],
  ];

  const presets: [string, { start: string; end: string }][] = [
    ['Tonight 10 PM–2 AM', presetNight(0, 22, 2)],
    ['Fri 10 PM–3 AM', presetNight(daysUntil(5), 22, 3)],
    ['Sat 10 PM–3 AM', presetNight(daysUntil(6), 22, 3)],
    ['Sun 4–9 PM', presetNight(daysUntil(0), 16, 21)],
  ];

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-24">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/admin/events" className="inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-800 mb-1">
            <ArrowLeft className="w-4 h-4" /> Events
          </Link>
          <h1 className="text-2xl font-black text-slate-900 truncate">{isNew ? 'New event' : event?.title}</h1>
        </div>
        {!isNew && event && (
          <a
            href={`/events/${event.id}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="w-4 h-4" /> View
          </a>
        )}
      </div>

      <Panel title="What">
        <div className="space-y-4">
          <Field label="Title">
            <input className={inputClass} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Afrobeats Friday with DJ Kool" maxLength={140} autoFocus={isNew} />
          </Field>
          <Field label="Description">
            <textarea
              className={inputClass}
              rows={4}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Who’s playing, dress code, specials…"
            />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Price / entry" hint="Shown on the card, e.g. “$20 at the door”, “Free before 11”.">
              <input className={inputClass} value={form.price_note} onChange={(e) => set('price_note', e.target.value)} maxLength={80} />
            </Field>
            <Field label="Tickets / info link">
              <input className={inputClass} value={form.ticket_url} onChange={(e) => set('ticket_url', e.target.value)} placeholder="https://…" />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel title="When (Nassau time)">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-1 bg-slate-100 rounded-xl p-1 text-sm font-extrabold">
            {(
              [
                ['once', 'One-off', CalendarDays],
                ['weekly', 'Every week', Repeat],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setRepeat(key)}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg ${form.repeat === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>

          {form.repeat === 'once' ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {presets.map(([label, p]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setForm((f) => (f ? { ...f, start: p.start, end: p.end } : f))}
                    className={chipClass(false)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Starts">
                  <input type="datetime-local" className={inputClass} value={form.start} onChange={(e) => set('start', e.target.value)} />
                </Field>
                <Field label="Ends">
                  <input type="datetime-local" className={inputClass} value={form.end} onChange={(e) => set('end', e.target.value)} />
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {weeklyPresets.map(([label, p]) => (
                  <button key={label} type="button" onClick={() => setForm((f) => (f ? { ...f, custom_times: false, ...p } : f))} className={chipClass(false)}>
                    {label}
                  </button>
                ))}
              </div>
              {form.custom_times ? (
                <HoursEditor value={form.hours} onChange={(v) => set('hours', v)} />
              ) : (
                <>
                  <Field label="Nights">
                    <div className="flex flex-wrap gap-1.5">
                      {WEEK_ORDER.map((d) => {
                        const on = form.days.includes(d);
                        return (
                          <button
                            key={d}
                            type="button"
                            aria-pressed={on}
                            onClick={() => set('days', on ? form.days.filter((x) => x !== d) : [...form.days, d])}
                            className={`${chipClass(on)} min-w-12`}
                          >
                            {DAY_NAMES[d].slice(0, 3)}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="From">
                      <input type="time" className={inputClass} value={form.open} onChange={(e) => set('open', e.target.value)} />
                    </Field>
                    <Field label="Until" hint="Earlier than “From” = past midnight.">
                      <input type="time" className={inputClass} value={form.close} onChange={(e) => set('close', e.target.value)} />
                    </Field>
                  </div>
                </>
              )}
              <button type="button" onClick={() => toggleCustomTimes(!form.custom_times)} className="text-sm font-extrabold text-brand-700 hover:underline">
                {form.custom_times ? 'Same time every night' : 'Different times on different nights'}
              </button>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="First night">
                  <input type="date" className={inputClass} value={form.first_night} onChange={(e) => set('first_night', e.target.value)} />
                </Field>
                {!form.no_end && (
                  <Field label="Last night">
                    <input type="date" className={inputClass} value={form.last_night} min={form.first_night} onChange={(e) => set('last_night', e.target.value)} />
                  </Field>
                )}
              </div>
              <Toggle
                checked={form.no_end}
                onChange={(v) => setForm((f) => (f ? { ...f, no_end: v, last_night: v ? f.last_night : f.last_night || addDays(f.first_night || todayNassau(), 27) } : f))}
                label="No end date"
                hint={form.no_end ? 'Repeats every week until you turn this off or delete the event.' : 'Stops after the last night (e.g. a festival or a summer series).'}
              />
              {hasHours(weeklyHours(form)) && (
                <p className="px-3 py-2.5 rounded-xl bg-brand-50 text-sm font-bold text-brand-800">
                  {recurrenceLabel(weeklyHours(form), true)}
                  {!form.custom_times && `, ${dayLabel({ open: form.open, close: form.close })}`}
                  {form.first_night && form.first_night > todayNassau() && ` · from ${shortDate(form.first_night)}`}
                  {form.no_end ? ' · until further notice' : form.last_night ? ` · last night ${shortDate(form.last_night)}` : ''}
                </p>
              )}
            </>
          )}
        </div>
      </Panel>

      <Panel title="Where">
        <div className="space-y-4">
          <Field label="Hosted at" hint="The event uses this spot’s pin unless you set its own location below.">
            <select className={inputClass} value={form.venue_id} onChange={(e) => set('venue_id', e.target.value)}>
              <option value="">— Not at a listed spot —</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.is_published ? '' : ' (draft)'}
                  {v.lat == null ? ' · no pin' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Toggle
            checked={form.own_location}
            onChange={(v) => set('own_location', v)}
            label="Its own location"
            hint={venue ? `Somewhere other than ${venue.name}’s pin.` : 'Beach parties, boat cruises, parades…'}
          />
          {form.own_location && (
            <>
              <LocationField value={form.location} onChange={(v) => set('location', v)} />
              <Field label="Address / directions">
                <input className={inputClass} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="e.g. Junkanoo Beach, West Bay St" />
              </Field>
            </>
          )}
        </div>
      </Panel>

      <Panel title="Flyer">
        {isNew || !event ? (
          <p className="text-sm font-semibold text-slate-500">Save the event first, then add a flyer or photo.</p>
        ) : (
          <div className="flex items-start gap-4">
            <div className="relative w-40 aspect-[4/5] rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
              {event.image_url ? (
                <>
                  <img src={event.image_url} alt="" className="w-full h-full object-cover" />
                  <button onClick={removeImage} className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white" aria-label="Remove flyer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-300">
                  <ImagePlus className="w-8 h-8" />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />} {event.image_url ? 'Replace' : 'Upload'}
              </Button>
              <p className="text-xs font-semibold text-slate-400">Compressed in the browser before upload.</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadImage(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Visibility">
        <div className="space-y-5">
          <Toggle
            checked={form.is_published}
            onChange={(v) => set('is_published', v)}
            label="Published"
            hint={form.is_published ? 'Listed on Events, the Explore rail and the map.' : 'Draft — only admins can see it.'}
          />
          <div className="border-t border-slate-100 pt-5">
            <Toggle
              checked={form.is_featured}
              onChange={(v) => set('is_featured', v)}
              label="Featured"
              hint="Pinned first on the Events page and the Explore rail, with a gold badge."
            />
          </div>
          {!isNew && (
            <div className="border-t border-slate-100 pt-5">
              <Button variant="secondary" onClick={remove} className="text-rose-600">
                <Trash2 className="w-4 h-4" /> Delete this event
              </Button>
            </div>
          )}
        </div>
      </Panel>

      {/* Save bar: always shown for a new event, on changes for an existing one. */}
      <div className="fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] md:bottom-0 z-[1400] pointer-events-none">
        <div className="max-w-3xl mx-auto px-3 pb-3">
          <div
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-2xl shadow-xl transition-all ${
              isNew || dirty ? 'bg-slate-900 text-white translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none'
            }`}
          >
            <span className="text-sm font-bold">{isNew ? 'New event' : 'Unsaved changes'}</span>
            <div className="flex gap-2">
              {!isNew && (
                <Button variant="ghost" className="text-slate-200 hover:bg-white/10" onClick={() => setForm(saved)}>
                  Discard
                </Button>
              )}
              <Button onClick={save} loading={saving}>
                <Save className="w-4 h-4" /> {isNew ? 'Create event' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
