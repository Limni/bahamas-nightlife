import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus, ExternalLink, Martini, Save, Trash2, UtensilsCrossed } from 'lucide-react';
import { supabase, MEDIA_BUCKET } from '@/lib/supabase';
import { useDirectory } from '@/lib/directory';
import { MENU_PHOTO_KIND, type MenuKind, type Venue } from '@/lib/types';
import type { WeeklyHours } from '@/lib/hours';
import { Spinner } from '@/components/ui';
import { Button, Field, inputClass, Panel, Toggle, useFeedback } from './ui';
import { LocationField, type LatLng } from './LocationField';
import { HoursEditor } from './HoursEditor';
import { TagPicker } from './TagPicker';
import { PhotoManager } from './PhotoManager';
import { MenuEditor } from './MenuEditor';
import { useConsole } from './console';
import { VenueManagersPanel } from './VenueManagers';

interface Form {
  name: string;
  slug: string;
  description: string;
  categories: string[];
  vibes: string[];
  area: string[];
  price_level: number | null;
  phone: string;
  website: string;
  instagram: string;
  facebook: string;
  address: string;
  location: LatLng | null;
  radius_m: number;
  hours: WeeklyHours;
  hours_note: string;
  visit_notes: NonNullable<Venue['visit_notes']>;
  is_published: boolean;
  is_featured: boolean;
  featured_until: string; // yyyy-mm-dd or ''
}

const toForm = (r: Venue): Form => ({
  name: r.name,
  slug: r.slug,
  description: r.description ?? '',
  categories: r.categories ?? [],
  vibes: r.vibes ?? [],
  area: r.area ? [r.area] : [],
  price_level: r.price_level,
  phone: r.phone ?? '',
  website: r.website ?? '',
  instagram: r.instagram ?? '',
  facebook: r.facebook ?? '',
  address: r.address ?? '',
  location: r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null,
  radius_m: r.radius_m ?? 60,
  hours: r.hours ?? {},
  hours_note: r.hours_note ?? '',
  visit_notes: r.visit_notes ?? {},
  is_published: r.is_published,
  is_featured: r.is_featured,
  featured_until: r.featured_until ? r.featured_until.slice(0, 10) : '',
});

const orNull = (s: string) => s.trim() || null;

const SECTIONS = [
  ['basics', 'Basics'],
  ['photos', 'Photos'],
  ['menu', 'Menus'],
  ['location', 'Location'],
  ['hours', 'Hours'],
  ['contact', 'Contact'],
  ['visibility', 'Visibility'],
] as const;

export default function VenueEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh } = useDirectory();
  const { toast, confirm } = useFeedback();
  const { role, base } = useConsole();
  const isAdmin = role === 'admin';
  const [venue, setVenue] = useState<Venue | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<Form | null>(null);
  const [menuTab, setMenuTab] = useState<MenuKind>('drinks');
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    supabase
      .from('venues')
      .select('*')
      .eq('id', id!)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return setMissing(true);
        setVenue(data as Venue);
        setForm(toForm(data as Venue));
        setSaved(toForm(data as Venue));
      });
  }, [id]);

  // Deep links like /manage/v/:id#menu: scroll once the panels exist.
  const loaded = !!venue;
  useEffect(() => {
    if (!loaded || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [loaded]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  if (missing) {
    return (
      <div className="text-center py-16">
        <p className="font-extrabold text-slate-700">That spot doesn’t exist (or was deleted).</p>
        <Link to={base} className="text-brand-600 font-bold">{isAdmin ? 'Back to spots' : 'Back to my venues'}</Link>
      </div>
    );
  }
  if (!form || !venue) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = async (overrides: Partial<Form> = {}) => {
    const f = { ...form, ...overrides };
    if (!f.name.trim()) return toast('Name can’t be empty', 'error');
    setSaving(true);
    // Managers don't send the admin-only fields (the database ignores them anyway).
    const adminOnly = isAdmin
      ? {
          slug: f.slug.trim() || null,
          radius_m: Math.round(Math.min(400, Math.max(15, f.radius_m))),
          is_published: f.is_published,
          is_featured: f.is_featured,
          featured_until: f.is_featured && f.featured_until ? new Date(`${f.featured_until}T23:59:59-05:00`).toISOString() : null,
        }
      : {};
    const { data, error } = await supabase
      .from('venues')
      .update({
        ...adminOnly,
        name: f.name.trim(),
        description: orNull(f.description),
        categories: f.categories,
        vibes: f.vibes,
        area: f.area[0] ?? null,
        price_level: f.price_level,
        phone: orNull(f.phone),
        website: orNull(f.website),
        instagram: orNull(f.instagram),
        facebook: orNull(f.facebook),
        address: orNull(f.address),
        lat: f.location?.lat ?? null,
        lng: f.location?.lng ?? null,
        hours: Object.keys(f.hours).length ? f.hours : null,
        hours_note: orNull(f.hours_note),
        visit_notes: f.visit_notes,
      })
      .eq('id', venue.id)
      .select('*')
      .single();
    setSaving(false);
    if (error) return toast(error.code === '23505' ? 'That URL slug is already used by another spot.' : error.message, 'error');
    const next = toForm(data as Venue);
    setVenue(data as Venue);
    setForm(next);
    setSaved(next);
    refresh();
    toast('Saved');
  };

  const setCover = async (url: string | null) => {
    const { error } = await supabase.from('venues').update({ cover_url: url }).eq('id', venue.id);
    if (error) return toast(error.message, 'error');
    setVenue((r) => (r ? { ...r, cover_url: url } : r));
    refresh();
    if (url) toast('Cover photo updated');
  };

  const publishToggle = async (on: boolean) => {
    if (on && !form.location) {
      const ok = await confirm({
        title: 'Publish without a map pin?',
        body: 'It will show in the directory but not on the map until you add a location.',
        confirmLabel: 'Publish anyway',
      });
      if (!ok) return;
    }
    // Publishing saves everything else too, so the live listing matches the form.
    await save({ is_published: on });
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${venue.name}?`,
      body: 'This permanently removes the listing, its photos and menu. This can’t be undone.',
      confirmLabel: 'Delete forever',
      danger: true,
    });
    if (!ok) return;
    const [{ data: photos }, { data: items }] = await Promise.all([
      supabase.from('venue_photos').select('storage_path').eq('venue_id', venue.id),
      supabase.from('menu_items').select('photo_path').eq('venue_id', venue.id).not('photo_path', 'is', null),
    ]);
    const { error } = await supabase.from('venues').delete().eq('id', venue.id);
    if (error) return toast(error.message, 'error');
    const paths = [...(photos ?? []).map((p) => p.storage_path), ...(items ?? []).map((i) => i.photo_path)].filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from(MEDIA_BUCKET).remove(paths);
    refresh();
    toast('Deleted');
    navigate('/admin', { replace: true });
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-24">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={base} className="inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-800 mb-1">
            <ArrowLeft className="w-4 h-4" /> {isAdmin ? 'Spots' : 'My venues'}
          </Link>
          <h1 className="text-2xl font-black text-slate-900 truncate">{venue.name}</h1>
          <span className={`inline-block mt-1 px-2 py-0.5 rounded-md text-[11px] font-extrabold uppercase ${venue.is_published ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
            {venue.is_published ? 'Live' : 'Draft'}
          </span>
        </div>
        <a href={`/v/${venue.slug}`} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
          <ExternalLink className="w-4 h-4" /> View
        </a>
      </div>

      <nav className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3 md:mx-0 md:px-0">
        {SECTIONS.map(([key, label]) => (
          <a key={key} href={`#${key}`} className="shrink-0 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-extrabold text-slate-700 hover:border-brand-300">
            {label}
          </a>
        ))}
      </nav>

      <Panel title="Basics" id="basics">
        <div className="space-y-4">
          <Field label="Name">
            <input className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea className={inputClass} rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="The crowd, the music, the best night to go…" />
          </Field>
          <Field label="Category" hint="The first one picks the map pin colour.">
            <TagPicker kind="category" value={form.categories} onChange={(v) => set('categories', v)} />
          </Field>
          <Field label="Vibe">
            <TagPicker kind="vibe" value={form.vibes} onChange={(v) => set('vibes', v)} />
          </Field>
          <Field label="Area">
            <TagPicker kind="area" single value={form.area} onChange={(v) => set('area', v)} />
          </Field>
          <Field label="Price">
            <div className="grid grid-cols-4 gap-1.5 max-w-xs">
              {[1, 2, 3, 4].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set('price_level', form.price_level === p ? null : p)}
                  className={`py-2 rounded-xl text-sm font-black border ${form.price_level === p ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}
                >
                  {'$'.repeat(p)}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Panel>

      <Panel title="Photos" id="photos">
        <PhotoManager
          venueId={venue.id}
          kind="gallery"
          coverUrl={venue.cover_url}
          onSetCover={setCover}
          onGpsFound={(pos) => {
            if (form.location) return;
            set('location', pos);
            toast('Location set from photo GPS — remember to save');
          }}
        />
      </Panel>

      <Panel title="Drinks & food menus" id="menu">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-1 bg-slate-100 rounded-xl p-1 text-sm font-extrabold">
            {(
              [
                ['drinks', 'Drinks', Martini],
                ['food', 'Food', UtensilsCrossed],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMenuTab(key)}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg ${menuTab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>
          <div>
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">{menuTab === 'drinks' ? 'Drinks' : 'Food'} menu photos</h3>
            <PhotoManager key={menuTab} venueId={venue.id} kind={MENU_PHOTO_KIND[menuTab]} />
          </div>
          <div>
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">
              {menuTab === 'drinks' ? 'Drinks' : 'Food'} items (optional, easier to read; tap the square to add a photo)
            </h3>
            <MenuEditor key={menuTab} venueId={venue.id} menu={menuTab} />
          </div>
        </div>
      </Panel>

      <Panel title="Location" id="location">
        <div className="space-y-4">
          <LocationField value={form.location} onChange={(v) => set('location', v)} />
          <Field label="Address / directions">
            <input className={inputClass} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="e.g. West Bay St, next to the Fish Fry" />
          </Field>
          {isAdmin && (
          <Field
            label={`Activity radius · ${form.radius_m} m`}
            hint="Phones within this distance of the pin count as “here” for live activity. ~40 m for a small bar, 80–150 m for a beach bar or big club."
          >
            <input
              type="range"
              min={15}
              max={300}
              step={5}
              value={form.radius_m}
              onChange={(e) => set('radius_m', Number(e.target.value))}
              className="w-full max-w-sm accent-brand-600"
            />
          </Field>
          )}
        </div>
      </Panel>

      <Panel title="Hours" id="hours">
        <div className="space-y-4">
          <HoursEditor value={form.hours} onChange={(v) => set('hours', v)} />
          <Field label="Hours note">
            <input className={inputClass} value={form.hours_note} onChange={(e) => set('hours_note', e.target.value)} placeholder="e.g. Last call 1:30 AM · Cover after 11 PM · Kitchen till 10" />
          </Field>
        </div>
      </Panel>

      <Panel
        title="Events here"
        action={
          <Link to={`${base}/events/new?venue=${venue.id}`} className="inline-flex items-center gap-1.5 text-sm font-extrabold text-brand-700 hover:underline">
            <CalendarPlus className="w-4 h-4" /> New event
          </Link>
        }
      >
        <p className="text-sm font-semibold text-slate-500">
          Highlight a DJ night, live band or party at this spot. It glows on the map while it’s on. See all in{' '}
          <Link to={`${base}/events`} className="font-extrabold text-brand-700 hover:underline">Events</Link>.
        </p>
      </Panel>

      <Panel title="Plan your visit" id="visit">
        <p className="mb-4 text-sm text-slate-600">Add only details confirmed with the venue. Leave unknown information blank.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Dress code"><input className={inputClass} maxLength={300} value={form.visit_notes.dress_code ?? ''} onChange={e => set('visit_notes', { ...form.visit_notes, dress_code: e.target.value })} /></Field>
          <Field label="Age policy"><input className={inputClass} maxLength={300} value={form.visit_notes.age_policy ?? ''} onChange={e => set('visit_notes', { ...form.visit_notes, age_policy: e.target.value })} /></Field>
          <Field label="Parking"><input className={inputClass} maxLength={300} value={form.visit_notes.parking ?? ''} onChange={e => set('visit_notes', { ...form.visit_notes, parking: e.target.value })} /></Field>
          <Field label="Accessibility"><input className={inputClass} maxLength={300} value={form.visit_notes.accessibility ?? ''} onChange={e => set('visit_notes', { ...form.visit_notes, accessibility: e.target.value })} /></Field>
          <Field label="Reservations / WhatsApp"><input className={inputClass} maxLength={300} value={form.visit_notes.reservations ?? ''} onChange={e => set('visit_notes', { ...form.visit_notes, reservations: e.target.value })} /></Field>
          <Field label="Happy hour"><input className={inputClass} maxLength={300} value={form.visit_notes.happy_hour ?? ''} onChange={e => set('visit_notes', { ...form.visit_notes, happy_hour: e.target.value })} /></Field>
        </div>
      </Panel>

      <Panel title="Contact" id="contact">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Phone">
            <input className={inputClass} type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="242-555-0123" />
          </Field>
          <Field label="Website">
            <input className={inputClass} value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="example.com" />
          </Field>
          <Field label="Instagram">
            <input className={inputClass} value={form.instagram} onChange={(e) => set('instagram', e.target.value)} placeholder="@handle" />
          </Field>
          <Field label="Facebook">
            <input className={inputClass} value={form.facebook} onChange={(e) => set('facebook', e.target.value)} placeholder="page name or URL" />
          </Field>
        </div>
      </Panel>

      {isAdmin && <VenueManagersPanel venueId={venue.id} venueName={venue.name} />}

      {!isAdmin && (
        <Panel title="Visibility" id="visibility">
          <p className="text-sm font-semibold text-slate-600">
            {venue.is_published ? 'Your listing is live.' : 'Your listing is a draft; the Nassau Nights team will publish it.'} Publishing, featured
            placement, the web address and reviews are handled by the Nassau Nights team. Reviews and likes come from visitors and can’t be edited
            here.
          </p>
        </Panel>
      )}

      {isAdmin && (
      <Panel title="Visibility" id="visibility">
        <div className="space-y-5">
          <Toggle
            checked={form.is_published}
            onChange={publishToggle}
            label="Published"
            hint={form.is_published ? 'Visible in the directory and on the map.' : 'Draft — only admins can see it.'}
          />
          <div className="border-t border-slate-100 pt-5 space-y-3">
            <Toggle
              checked={form.is_featured}
              onChange={(v) => set('is_featured', v)}
              label="Featured / sponsored"
              hint="Pinned to the top of the directory, with a gold star on the map."
            />
            {form.is_featured && (
              <Field label="Featured until" hint="Leave empty to keep it featured until you turn it off.">
                <input type="date" className={`${inputClass} max-w-xs`} value={form.featured_until} onChange={(e) => set('featured_until', e.target.value)} />
              </Field>
            )}
          </div>
          <div className="border-t border-slate-100 pt-5">
            <Field label="URL slug" hint={`nassaunights…/v/${form.slug || '…'} — changing it breaks old links.`}>
              <input className={`${inputClass} max-w-sm`} value={form.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
            </Field>
          </div>
          <div className="border-t border-slate-100 pt-5">
            <Button variant="secondary" onClick={remove} className="text-rose-600">
              <Trash2 className="w-4 h-4" /> Delete this spot
            </Button>
          </div>
        </div>
      </Panel>
      )}

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] md:bottom-0 z-[1400] pointer-events-none">
        <div className="max-w-3xl mx-auto px-3 pb-3">
          <div
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-2xl shadow-xl transition-all ${
              dirty ? 'bg-slate-900 text-white translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none'
            }`}
          >
            <span className="text-sm font-bold">Unsaved changes</span>
            <div className="flex gap-2">
              <Button variant="ghost" className="text-slate-200 hover:bg-white/10" onClick={() => setForm(saved)}>
                Discard
              </Button>
              <Button onClick={() => save()} loading={saving}>
                <Save className="w-4 h-4" /> Save
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
