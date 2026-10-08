import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CheckCircle2, Clock, ImagePlus, Inbox as InboxIcon, Mail, Plus, Trash2, XCircle } from 'lucide-react';
import { supabase, SUBMISSION_BUCKET } from '@/lib/supabase';
import { uploadMedia } from '@/lib/images';
import { SUBMISSION_KIND_LABELS, type PhotoKind, type Submission, type SubmissionStatus } from '@/lib/types';
import { Spinner } from '@/components/ui';
import { Lightbox } from '@/components/Lightbox';
import { Button, useFeedback } from './ui';

type Row = Submission & { venues: { id: string; name: string; slug: string } | null };

const TABS: { key: SubmissionStatus; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'reviewing', label: 'In progress' },
  { key: 'done', label: 'Done' },
  { key: 'dismissed', label: 'Dismissed' },
];

const KIND_STYLE: Record<string, string> = {
  new_spot: 'bg-brand-100 text-brand-800',
  update: 'bg-sky-100 text-sky-800',
  closed: 'bg-rose-100 text-rose-800',
  event: 'bg-violet-100 text-violet-800',
  other: 'bg-slate-200 text-slate-700',
};

function SubmissionCard({ s, onChanged }: { s: Row; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [urls, setUrls] = useState<string[]>([]);
  const [note, setNote] = useState(s.admin_note ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [imported, setImported] = useState<Record<string, PhotoKind>>({});

  // Suggestion photos live in a private bucket — mint short-lived links to view them.
  useEffect(() => {
    if (!s.photo_paths.length) return;
    supabase.storage
      .from(SUBMISSION_BUCKET)
      .createSignedUrls(s.photo_paths, 60 * 60)
      .then(({ data }) => setUrls((data ?? []).map((d) => d.signedUrl ?? '')));
  }, [s.photo_paths]);

  const setStatus = async (status: SubmissionStatus) => {
    setBusy(status);
    const { error } = await supabase.from('submissions').update({ status, admin_note: note.trim() || null }).eq('id', s.id);
    setBusy(null);
    if (error) return toast(error.message, 'error');
    toast(status === 'done' ? 'Marked done — thanks credited on the community page' : 'Updated');
    window.dispatchEvent(new Event('inbox-changed'));
    onChanged();
  };

  const saveNote = async () => {
    if ((s.admin_note ?? '') === note.trim()) return;
    await supabase.from('submissions').update({ admin_note: note.trim() || null }).eq('id', s.id);
  };

  // Copy a suggestion photo into the spot's public gallery or menu.
  const importPhoto = async (path: string, kind: PhotoKind) => {
    if (!s.venue_id) return;
    setBusy(path);
    try {
      const { data: blob, error } = await supabase.storage.from(SUBMISSION_BUCKET).download(path);
      if (error || !blob) throw error ?? new Error('Download failed');
      const file = new File([blob], path.split('/').pop() ?? 'photo.jpg', { type: blob.type || 'image/jpeg' });
      const { url, path: mediaPath } = await uploadMedia(file, `${s.venue_id}/${kind}`);
      const { error: rowError } = await supabase
        .from('venue_photos')
        .insert({ venue_id: s.venue_id, kind, url, storage_path: mediaPath, sort: Date.now() % 1_000_000, caption: null });
      if (rowError) throw rowError;
      setImported((m) => ({ ...m, [path]: kind }));
      toast(`Added to ${kind === 'menu' ? 'menu photos' : 'gallery'}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Delete this suggestion?', body: 'Attached photos are deleted too.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('submissions').delete().eq('id', s.id);
    if (error) return toast(error.message, 'error');
    if (s.photo_paths.length) await supabase.storage.from(SUBMISSION_BUCKET).remove(s.photo_paths);
    window.dispatchEvent(new Event('inbox-changed'));
    onChanged();
  };

  const draftLink = `/admin/new?${new URLSearchParams({ name: s.venue_name ?? '', notes: s.message, from: s.id })}`;

  return (
    <li className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold uppercase ${KIND_STYLE[s.kind]}`}>{SUBMISSION_KIND_LABELS[s.kind]}</span>
        {s.venues ? (
          <Link to={`/admin/v/${s.venues.id}`} className="font-extrabold text-slate-900 hover:text-brand-700">
            {s.venues.name}
          </Link>
        ) : (
          s.venue_name && <span className="font-extrabold text-slate-900">{s.venue_name}</span>
        )}
        <span className="ml-auto text-xs font-semibold text-slate-400">
          {new Date(s.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>

      {s.fields.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {s.fields.map((f) => (
            <span key={f} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-bold">
              {f}
            </span>
          ))}
        </div>
      )}

      <p className="text-[15px] text-slate-800 whitespace-pre-line">{s.message}</p>

      {urls.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {s.photo_paths.map((path, i) => (
            <li key={path} className="w-28">
              <button type="button" onClick={() => setViewer(i)} className="block w-28 h-28 rounded-xl overflow-hidden bg-slate-100">
                {urls[i] && <img src={urls[i]} alt="" className="w-full h-full object-cover" />}
              </button>
              {s.venue_id &&
                (imported[path] ? (
                  <p className="text-[11px] font-extrabold text-emerald-700 mt-1 text-center">Added to {imported[path]}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1 mt-1">
                    <button type="button" disabled={busy === path} onClick={() => importPhoto(path, 'gallery')} className="flex items-center justify-center py-1 rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50" title="Add to gallery">
                      <ImagePlus className="w-4 h-4" />
                    </button>
                    <button type="button" disabled={busy === path} onClick={() => importPhoto(path, 'menu')} className="flex items-center justify-center py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50" title="Add to menu photos">
                      <BookOpen className="w-4 h-4" />
                    </button>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}

      {(s.contact_name || s.contact_email) && (
        <p className="text-sm font-semibold text-slate-500 flex flex-wrap items-center gap-x-3">
          <span>From {s.contact_name || 'anonymous'}</span>
          {s.contact_email && (
            <a href={`mailto:${s.contact_email}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
              <Mail className="w-3.5 h-3.5" /> {s.contact_email}
            </a>
          )}
          {!s.credit_ok && <span className="text-xs text-slate-400">(prefers no public credit)</span>}
        </p>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={saveNote}
        rows={1}
        placeholder="Private note…"
        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold outline-none focus:border-brand-500 resize-y"
      />

      <div className="flex flex-wrap gap-2">
        {s.kind === 'new_spot' && (
          <Link to={draftLink} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-extrabold hover:bg-brand-700">
            <Plus className="w-4 h-4" /> Create draft
          </Link>
        )}
        {s.kind === 'event' && (
          <Link
            to={`/admin/events/new?${new URLSearchParams({ ...(s.venue_id ? { venue: s.venue_id } : {}), notes: s.message })}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-extrabold hover:bg-brand-700"
          >
            <Plus className="w-4 h-4" /> Create event
          </Link>
        )}
        {s.status !== 'reviewing' && (
          <Button variant="secondary" loading={busy === 'reviewing'} onClick={() => setStatus('reviewing')}>
            <Clock className="w-4 h-4" /> In progress
          </Button>
        )}
        {s.status !== 'done' && (
          <Button variant="secondary" loading={busy === 'done'} onClick={() => setStatus('done')} className="text-emerald-700">
            <CheckCircle2 className="w-4 h-4" /> Done
          </Button>
        )}
        {s.status !== 'dismissed' && (
          <Button variant="ghost" loading={busy === 'dismissed'} onClick={() => setStatus('dismissed')}>
            <XCircle className="w-4 h-4" /> Dismiss
          </Button>
        )}
        <Button variant="ghost" onClick={remove} className="ml-auto text-rose-600">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      <Lightbox images={urls.map((url) => ({ url }))} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
    </li>
  );
}

export default function Inbox() {
  const [tab, setTab] = useState<SubmissionStatus>('new');
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from('submissions')
      .select('*, venues(id, name, slug)')
      .eq('status', tab)
      .order('created_at', { ascending: false })
      .limit(100);
    setRows((data as Row[]) ?? []);
  };

  useEffect(() => {
    setRows(null);
    load();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Inbox</h1>
        <p className="text-sm font-semibold text-slate-500">Suggestions and corrections from the community.</p>
      </div>
      <div className="flex gap-1 bg-white rounded-xl p-1 border border-slate-200 text-xs font-extrabold w-fit">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-1.5 rounded-lg ${tab === t.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {rows === null ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <InboxIcon className="w-8 h-8 mx-auto text-slate-300" />
          <p className="mt-2 font-extrabold text-slate-600">Nothing here</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <SubmissionCard key={s.id} s={s} onChanged={load} />
          ))}
        </ul>
      )}
    </div>
  );
}
