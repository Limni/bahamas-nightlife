import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Heart, ImagePlus, Loader2, PartyPopper, Search, Send, Sparkles, X } from 'lucide-react';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { useDirectory } from '@/lib/directory';
import { useAuth } from '@/lib/auth';
import { compressImage } from '@/lib/images';
import type { SubmissionKind } from '@/lib/types';
import { Chip } from '@/components/ui';
import { SetupNotice } from '@/components/SetupNotice';

const KINDS: { key: SubmissionKind; label: string; hint: string }[] = [
  { key: 'new_spot', label: 'Suggest a spot', hint: 'A place you want to see listed' },
  { key: 'update', label: 'Update info', hint: 'Phone, hours, menu, prices…' },
  { key: 'closed', label: 'Closed or moved', hint: 'Shut down or new location' },
  { key: 'event', label: 'Event tip', hint: 'A party, DJ night or show coming up' },
  { key: 'other', label: 'Something else', hint: 'Ideas, feedback, shout-outs' },
];

const FIELDS = ['Hours', 'Drinks menu', 'Prices', 'Cover charge', 'Phone', 'Location', 'Photos', 'Website / socials', 'Other'];
const FIELD_PARAM: Record<string, string> = { menu: 'Drinks menu', photos: 'Photos', hours: 'Hours', phone: 'Phone' };
const MAX_PHOTOS = 6;
const RATE_KEY = 'submissions:sent';

interface Contribution {
  first_name: string;
  kind: SubmissionKind;
  venue_name: string | null;
  resolved_at: string;
}

function contributionText(c: Contribution) {
  const place = c.venue_name ?? 'a spot';
  switch (c.kind) {
    case 'new_spot':
      return <>suggested <b>{place}</b>, now listed</>;
    case 'closed':
      return <>flagged a change at <b>{place}</b></>;
    case 'update':
      return <>updated the info for <b>{place}</b></>;
    case 'event':
      return c.venue_name ? <>tipped us off about a night at <b>{place}</b></> : <>tipped us off about an event</>;
    default:
      return <>helped improve the directory</>;
  }
}

/** Courtesy throttle; the Edge Function and database enforce the real quota. */
function recentlySent(): number[] {
  try {
    const list = JSON.parse(localStorage.getItem(RATE_KEY) ?? '[]') as number[];
    return list.filter((t) => Date.now() - t < 60 * 60 * 1000);
  } catch {
    return [];
  }
}

function VenuePicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { venues } = useDirectory();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = venues.find((r) => r.id === value) ?? null;
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? venues.filter((r) => r.name.toLowerCase().includes(q)) : venues).slice(0, 8);
  }, [venues, query]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-white/5 border border-white/20">
        <div className="min-w-0">
          <p className="font-extrabold text-white truncate">{selected.name}</p>
          {selected.area && <p className="text-xs font-semibold text-brand-200">{selected.area}</p>}
        </div>
        <button type="button" onClick={() => onChange(null)} className="p-1.5 rounded-full hover:bg-white/10 text-brand-300" aria-label="Change venue">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <label className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-night-950/70 border border-white/10 focus-within:border-brand-400">
        <Search className="w-4 h-4 text-brand-400" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          aria-label="Search for a venue"
          placeholder="Which spot?"
          className="flex-1 bg-transparent outline-none font-semibold text-night-50 placeholder:text-night-400"
        />
      </label>
      {open && results.length > 0 && (
        <ul className="absolute z-20 top-full mt-1 inset-x-0 bg-night-900 rounded-2xl border border-white/10 shadow-xl overflow-hidden max-h-72 overflow-y-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(r.id);
                  setQuery('');
                  setOpen(false);
                }}
                className="w-full text-left px-4 py-2.5 hover:bg-white/5"
              >
                <span className="font-bold text-white">{r.name}</span>
                {r.area && <span className="text-xs font-semibold text-brand-300 ml-2">{r.area}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Community() {
  const { session, profile } = useAuth();
  const [params] = useSearchParams();
  const initialKind = (KINDS.find((k) => k.key === params.get('kind'))?.key ?? 'new_spot') as SubmissionKind;
  const initialField = FIELD_PARAM[params.get('field') ?? ''];

  const [kind, setKind] = useState<SubmissionKind>(initialKind);
  const [venueId, setVenueId] = useState<string | null>(params.get('venue'));
  const [venueName, setVenueName] = useState('');
  const [fields, setFields] = useState<string[]>(initialField ? [initialField] : []);
  const [message, setMessage] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventStart, setEventStart] = useState('');
  const [eventEnd, setEventEnd] = useState('');
  const [eventPlace, setEventPlace] = useState('');
  const [eventLink, setEventLink] = useState('');
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [creditOk, setCreditOk] = useState(true);
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [wins, setWins] = useState<Contribution[]>([]);
  const [winCount, setWinCount] = useState<number | null>(null);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.rpc('recent_contributions', { p_limit: 10 }).then(({ data }) => data && setWins(data as Contribution[]));
    supabase.rpc('contribution_count').then(({ data }) => typeof data === 'number' && setWinCount(data));
  }, []);

  // Revoke preview URLs on unmount (removals revoke their own).
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const needsVenue = kind === 'update' || kind === 'closed';

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const next = [...files].filter((f) => f.type.startsWith('image/')).slice(0, MAX_PHOTOS - photos.length);
    setPhotos((p) => [...p, ...next.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  };

  const reset = () => {
    setStatus('idle');
    setMessage('');
    setEventTitle(''); setEventStart(''); setEventEnd(''); setEventPlace(''); setEventLink(''); request.current = null;
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setFields([]);
    setVenueName('');
    setVenueId(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (honeypot) return setStatus('sent'); // bots fill hidden fields
    if (needsVenue && !venueId) return setError('Pick the spot this is about.');
    if (kind === 'new_spot' && !venueName.trim()) return setError('What’s the name of the spot?');
    if (kind === 'event' && (!eventTitle.trim() || !eventStart || !eventEnd || eventEnd <= eventStart || (!venueId && !eventPlace.trim()))) return setError('Add the event title, location, and an end time after the start. Times are in Nassau.');
    if (!message.trim() && kind !== 'event') return setError('Add a short note so we know what to change.');
    const sent = recentlySent();
    if (sent.length >= 6) return setError('Thanks for all the help! Please try again in a little while.');

    setStatus('sending');
    try {
      const details = kind === 'event' ? `Event: ${eventTitle.trim()}\nStarts (Nassau): ${eventStart}\nEnds (Nassau): ${eventEnd}\nLocation: ${eventPlace.trim() || 'Selected venue'}\nTickets/info: ${eventLink.trim() || 'None'}\n\n${message.trim()}` : message.trim();
      if (details.length > 2000) throw new Error('Please shorten the details to fit the event information.');
      const payload = {
        kind,
        venue_id: needsVenue || kind === 'other' || kind === 'event' ? venueId : null,
        venue_name: kind === 'new_spot' ? venueName.trim() : null,
        fields: kind === 'update' ? fields : [],
        message: details,
        contact_name: (session ? profile?.display_name : contactName.trim()) || null,
        contact_email: (session ? session.user.email : contactEmail.trim()) || null,
        credit_ok: creditOk,
      };
      const fingerprint = JSON.stringify(payload) + photos.map(p => `${p.file.name}:${p.file.size}:${p.file.lastModified}`).join('|');
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
      const body = new FormData();
      body.set('request_id', request.current.id);
      body.set('suggestion', JSON.stringify(payload));
      for (const photo of photos) body.append('photos', await compressImage(photo.file,1600,0.78), 'photo');
      const { data, error: sendError } = await supabase.functions.invoke('submit-suggestion', { body });
      if (sendError) {
        let detail = 'Could not send. Please wait two minutes and try again.';
        if ('context' in sendError && sendError.context instanceof Response) {
          try { detail = (await sendError.context.json()).error || detail; } catch { /* use friendly fallback */ }
        }
        throw new Error(detail);
      }
      if (!data?.id) throw new Error(data?.error || 'Could not confirm your suggestion. Please try again.');
      try { localStorage.setItem(RATE_KEY, JSON.stringify([...sent, Date.now()])); } catch { /* The suggestion already succeeded. */ }
      setStatus('sent');
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.');
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 md:px-6 pb-12">
      <section className="pt-8 md:pt-12 pb-6">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400/15 text-amber-300 text-xs font-extrabold uppercase tracking-wider">
          <Heart className="w-3.5 h-3.5 fill-current" /> Built with the community
        </span>
        <h1 className="mt-3 text-3xl md:text-5xl font-extrabold text-white tracking-tight leading-[1.05]">
          Help keep Nassau’s nightlife <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-glow-400">up to date</span>
        </h1>
        <p className="mt-2 text-night-200 font-semibold md:text-lg max-w-2xl">
          Know a spot we’re missing? New hours, a new cover charge, a party coming up? Tell us — every listing gets better because of people like you.
        </p>
      </section>

      {!supabaseConfigured && <SetupNotice />}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {status === 'sent' ? (
            <div className="bg-night-900 rounded-3xl border border-white/10 p-8 text-center">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-emerald-400/10 text-emerald-400 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <h2 className="text-2xl font-extrabold text-white">Thank you!</h2>
              <p className="mt-2 text-night-200 font-semibold">
                Your suggestion is in. We review every one and update the listing once it checks out.
              </p>
              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                <button onClick={reset} className="px-5 py-3 rounded-2xl bg-brand-500 text-white font-extrabold hover:bg-brand-400">
                  Send another
                </button>
                <Link to="/" className="px-5 py-3 rounded-2xl bg-white/5 text-night-100 font-extrabold hover:bg-white/10">
                  Back to exploring
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="relative bg-night-900 rounded-3xl border border-white/10 p-5 md:p-7 space-y-6">
              <div>
                <p className="text-sm font-extrabold text-white mb-2.5">What’s this about?</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {KINDS.map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      onClick={() => setKind(k.key)}
                      className={`text-left p-3.5 rounded-2xl border-2 transition-all ${
                        kind === k.key ? 'border-brand-500 bg-white/5' : 'border-white/10 hover:border-white/20'
                      }`}
                    >
                      <span className="block font-extrabold text-white text-sm">{k.label}</span>
                      <span className="block text-xs font-semibold text-night-200 mt-0.5">{k.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              {kind === 'new_spot' ? (
                <label className="block">
                  <span className="text-sm font-extrabold text-white">Name of the spot</span>
                  <input
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                    maxLength={120}
                    placeholder="e.g. a rooftop bar on Bay Street"
                    className="mt-1.5 w-full px-4 py-3 rounded-2xl border border-white/10 bg-night-950/70 outline-none focus:border-brand-400 font-semibold text-white placeholder:text-night-500"
                  />
                </label>
              ) : (
                <div>
                  <span className="text-sm font-extrabold text-white">
                    {kind === 'event' ? 'Where is it?' : 'Which spot?'}
                    {(kind === 'other' || kind === 'event') && <span className="font-semibold text-night-300"> (optional)</span>}
                  </span>
                  <div className="mt-1.5">
                    <VenuePicker value={venueId} onChange={setVenueId} />
                  </div>
                </div>
              )}

              {kind === 'event' && <fieldset className="space-y-3">
                <legend className="font-bold text-white">Event details — Nassau time</legend>
                <label className="block text-sm font-bold">Event title<input required maxLength={120} value={eventTitle} onChange={e=>setEventTitle(e.target.value)} className="mt-1 w-full p-3 rounded-xl bg-night-950 border border-white/10" /></label>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block text-sm font-bold">Starts<input required type="datetime-local" value={eventStart} onChange={e=>setEventStart(e.target.value)} className="mt-1 w-full min-w-0 p-3 rounded-xl bg-night-950 border border-white/10" /></label>
                  <label className="block text-sm font-bold">Ends<input required type="datetime-local" value={eventEnd} onChange={e=>setEventEnd(e.target.value)} className="mt-1 w-full min-w-0 p-3 rounded-xl bg-night-950 border border-white/10" /></label>
                </div>
                <label className="block text-sm font-bold">Location or address{venueId ? ' (optional)' : ''}<input required={!venueId} maxLength={200} value={eventPlace} onChange={e=>setEventPlace(e.target.value)} className="mt-1 w-full p-3 rounded-xl bg-night-950 border border-white/10" /></label>
                <label className="block text-sm font-bold">Tickets / information link (optional)<input type="url" maxLength={300} value={eventLink} onChange={e=>setEventLink(e.target.value)} placeholder="https://" className="mt-1 w-full p-3 rounded-xl bg-night-950 border border-white/10" /></label>
              </fieldset>}

              {kind === 'update' && (
                <div>
                  <p className="text-sm font-extrabold text-white mb-2">What changed?</p>
                  <div className="flex flex-wrap gap-2">
                    {FIELDS.map((f) => (
                      <Chip
                        key={f}
                        size="sm"
                        active={fields.includes(f)}
                        onClick={() => setFields((list) => (list.includes(f) ? list.filter((x) => x !== f) : [...list, f]))}
                      >
                        {f}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              <label className="block">
                <span className="text-sm font-extrabold text-white">Details</span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={2000}
                  rows={5}
                  placeholder={
                    kind === 'new_spot'
                      ? 'Where is it, what kind of spot, what nights are best?'
                      : kind === 'update'
                        ? 'e.g. They now stay open till 3 AM on Saturdays, and cover is $20 after 11.'
                        : kind === 'event'
                          ? 'What, when, where — and a link or flyer if you have one.'
                          : 'Tell us what you know.'
                  }
                  className="mt-1.5 w-full px-4 py-3 rounded-2xl border border-white/10 bg-night-950/70 outline-none focus:border-brand-400 font-semibold text-white placeholder:text-night-500 resize-y"
                />
              </label>

              <div>
                <p className="text-sm font-extrabold text-white">
                  Photos <span className="font-semibold text-night-300">(optional — flyers, drinks menus, the place)</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {photos.map((p, i) => (
                    <div key={p.preview} className="relative w-20 h-20 rounded-2xl overflow-hidden bg-white/5">
                      <img src={p.preview} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => {
                          URL.revokeObjectURL(p.preview);
                          setPhotos((list) => list.filter((_, j) => j !== i));
                        }}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white"
                        aria-label="Remove photo"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {photos.length < MAX_PHOTOS && (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="w-20 h-20 rounded-2xl border-2 border-dashed border-white/20 text-brand-400 flex flex-col items-center justify-center hover:bg-white/5 hover:border-brand-400/60"
                    >
                      <ImagePlus className="w-6 h-6" />
                      <span className="text-[10px] font-extrabold mt-0.5">Add</span>
                    </button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      addPhotos(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>

              {session ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 rounded-2xl bg-glow-500/10 border border-glow-400/25 text-sm font-semibold text-night-50">
                  <span>
                    Sending as <b>{profile?.display_name ?? session.user.email}</b>. Follow its status in{' '}
                    <Link to="/account" className="font-extrabold text-brand-300 underline">your account</Link>.
                  </span>
                </div>
              ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-extrabold text-white">Your name <span className="font-semibold text-night-300">(optional)</span></span>
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    maxLength={80}
                    autoComplete="given-name"
                    className="mt-1.5 w-full px-4 py-3 rounded-2xl border border-white/10 bg-night-950/70 outline-none focus:border-brand-400 font-semibold text-white placeholder:text-night-500"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-extrabold text-white">Email <span className="font-semibold text-night-300">(optional, for follow-ups)</span></span>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    maxLength={200}
                    autoComplete="email"
                    className="mt-1.5 w-full px-4 py-3 rounded-2xl border border-white/10 bg-night-950/70 outline-none focus:border-brand-400 font-semibold text-white placeholder:text-night-500"
                  />
                </label>
              </div>
              )}
              {!session && (
                <p className="text-xs font-semibold text-night-300 -mt-3">
                  <Link to="/account?next=/community" className="font-extrabold text-brand-300 underline">Sign in</Link> to follow the status of your suggestions.
                </p>
              )}
              {/* Honeypot: hidden from people, irresistible to bots. */}
              <input
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                name="website"
                aria-hidden="true"
                className="absolute -left-[9999px] w-px h-px opacity-0"
              />
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={creditOk} onChange={(e) => setCreditOk(e.target.checked)} className="w-4 h-4 accent-brand-500" />
                <span className="text-sm font-semibold text-night-50">Thank me by first name on the community board</span>
              </label>

              {error && <p className="text-sm font-bold text-rose-200 bg-rose-500/10 border border-rose-400/30 rounded-2xl px-4 py-3">{error}</p>}

              <button
                type="submit"
                disabled={status === 'sending' || !supabaseConfigured}
                className="w-full py-4 rounded-2xl font-extrabold text-white text-lg bg-gradient-to-r from-brand-500 to-glow-500 hover:brightness-110 glow-brand disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {status === 'sending' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                {status === 'sending' ? (photos.length ? 'Uploading photos…' : 'Sending…') : 'Send suggestion'}
              </button>
            </form>
          )}
        </div>

        <aside className="lg:col-span-2 space-y-4">
          <div className="rounded-3xl p-6 bg-gradient-to-br from-brand-600 to-glow-600 text-white glow-brand">
            <PartyPopper className="w-8 h-8 mb-2" />
            <p className="font-display text-4xl font-extrabold">{winCount ?? '—'}</p>
            <p className="font-bold text-white/90">community updates applied so far</p>
          </div>
          <div className="bg-night-900 rounded-3xl border border-white/10 p-5">
            <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-widest text-brand-300 mb-3">
              <Sparkles className="w-4 h-4" /> Community wins
            </h2>
            {wins.length === 0 ? (
              <p className="text-sm font-semibold text-night-300">Be the first — your suggestion could show up here.</p>
            ) : (
              <ul className="space-y-3">
                {wins.map((c, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="w-8 h-8 shrink-0 rounded-full bg-amber-400/15 text-amber-300 font-black flex items-center justify-center">
                      {c.first_name.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-night-100 font-semibold">
                      <b className="text-white">{c.first_name}</b> {contributionText(c)}
                      <span className="block text-xs text-night-400">
                        {new Date(c.resolved_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
