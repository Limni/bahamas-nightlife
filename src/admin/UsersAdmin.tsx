import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, ChevronDown, KeyRound, MailCheck, Search, Send, ShieldCheck, ShieldOff, Trash2, Undo2, UserPlus, Users as UsersIcon, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useDirectory } from '@/lib/directory';
import { SUBMISSION_KIND_LABELS, type SubmissionKind, type SubmissionStatus } from '@/lib/types';
import { Spinner, Stars } from '@/components/ui';
import { Button, Field, inputClass, useFeedback } from './ui';

/** One row of `admin_list_users()`: auth.users joined with profile and counts. */
interface Member {
  id: string;
  email: string | null;
  display_name: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null; // only set while the suspension is in force
  invited_at: string | null;
  is_admin: boolean;
  review_count: number;
  hidden_review_count: number;
  submission_count: number;
  total_count: number;
}

type Filter = 'all' | 'admins' | 'invited' | 'suspended' | 'unconfirmed';
const PAGE = 50;

const SUSPEND_FOR: [string, number | null][] = [
  ['1 day', 1],
  ['7 days', 7],
  ['30 days', 30],
  ['Indefinitely', null],
];

const STATUS_LABELS: Record<SubmissionStatus, string> = {
  new: 'New',
  reviewing: 'In progress',
  done: 'Done',
  dismissed: 'Dismissed',
};

const day = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function ago(d: string | null) {
  if (!d) return 'never';
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return '1 day ago';
  return days < 60 ? `${days} days ago` : day(d);
}

// A suspension is stored as a date ~100 years out when it's "for good".
const suspendedLabel = (until: string) =>
  new Date(until).getFullYear() - new Date().getFullYear() > 50 ? 'Suspended' : `Suspended until ${day(until)}`;

const NOT_DEPLOYED = 'The invite-member function isn’t deployed yet. See DEPLOY.md, “Member invitations”.';

/**
 * Sends (or re-sends) an invitation through the invite-member Edge Function,
 * which holds the service-role key. Supabase sends the "Invite user" email.
 */
async function sendInvite(body: { email: string; display_name?: string; make_admin?: boolean }) {
  const { data, error } = await supabase.functions.invoke('invite-member', {
    body: { ...body, redirect_to: `${window.location.origin}/account` },
  });
  if (!error) return { error: null, warning: (data as { warning?: string } | null)?.warning ?? null };
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    if (ctx.status === 404) return { error: NOT_DEPLOYED, warning: null };
    try {
      const b = await ctx.json();
      if (b?.error) return { error: String(b.error), warning: null };
    } catch {
      /* not JSON */
    }
  }
  // A function that doesn't exist answers without CORS headers, so it shows up as a fetch error.
  if (error.name === 'FunctionsFetchError') return { error: `Couldn’t reach the invite function. ${NOT_DEPLOYED}`, warning: null };
  return { error: error.message, warning: null };
}

const pendingInvite = (m: Member) => !!m.invited_at && !m.email_confirmed_at;

function Badge({ tone, children }: { tone: 'brand' | 'rose' | 'amber' | 'slate'; children: React.ReactNode }) {
  const tones = {
    brand: 'bg-brand-100 text-brand-800',
    rose: 'bg-rose-100 text-rose-700',
    amber: 'bg-amber-100 text-amber-800',
    slate: 'bg-slate-200 text-slate-600',
  };
  return <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold uppercase whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

/** Member accounts: search, admin access, suspensions, confirmation, reset, delete. */
export default function UsersAdmin({ meId }: { meId: string }) {
  const { toast } = useFeedback();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<Member[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const reqId = useRef(0);

  // Debounce the search box; the RPC searches server-side.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const fetchPage = async (offset: number) => {
    const { data, error } = await supabase.rpc('admin_list_users', {
      p_search: search || null,
      p_filter: filter,
      p_limit: PAGE,
      p_offset: offset,
    });
    if (error) toast(error.message, 'error');
    return (data as Member[] | null) ?? [];
  };

  const reload = async () => {
    // Ignore responses that arrive after a newer search/filter started.
    const id = ++reqId.current;
    const data = await fetchPage(0);
    if (id === reqId.current) setRows(data);
  };

  useEffect(() => {
    setRows(null);
    reload();
  }, [search, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = async () => {
    if (!rows) return;
    setLoadingMore(true);
    const id = reqId.current;
    const more = await fetchPage(rows.length);
    if (id === reqId.current) setRows([...rows, ...more.filter((m) => !rows.some((r) => r.id === m.id))]);
    setLoadingMore(false);
  };

  const total = rows?.[0]?.total_count ?? 0;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Members</h1>
          <p className="text-sm font-semibold text-slate-500">
            Everyone with an account. Emails are shown only here; the public site shows display names.
          </p>
        </div>
        {!inviting && (
          <Button onClick={() => setInviting(true)} className="shrink-0">
            <UserPlus className="w-4 h-4" /> Invite
          </Button>
        )}
      </div>

      {inviting && <InvitePanel onClose={() => setInviting(false)} onSent={reload} />}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className={`${inputClass} pl-9`}
            type="search"
            placeholder="Search name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-1 bg-white rounded-xl p-1 border border-slate-200 text-xs font-extrabold w-fit overflow-x-auto no-scrollbar">
          {(
            [
              ['all', 'All'],
              ['admins', 'Admins'],
              ['suspended', 'Suspended'],
              ['invited', 'Invited'],
              ['unconfirmed', 'Unconfirmed'],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap ${filter === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows === null ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <UsersIcon className="w-8 h-8 mx-auto text-slate-300" />
          <p className="mt-2 font-extrabold text-slate-600">No members here</p>
        </div>
      ) : (
        <>
          <p className="text-xs font-bold text-slate-500">
            {total} {total === 1 ? 'member' : 'members'}
            {rows.length < total && ` · showing ${rows.length}`}
          </p>
          <ul className="space-y-2">
            {rows.map((m) => (
              <MemberRow
                key={m.id}
                m={m}
                me={m.id === meId}
                open={open === m.id}
                onToggle={() => setOpen(open === m.id ? null : m.id)}
                onChanged={reload}
              />
            ))}
          </ul>
          {rows.length < total && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={loadingMore} onClick={loadMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MemberRow({ m, me, open, onToggle, onChanged }: { m: Member; me: boolean; open: boolean; onToggle: () => void; onChanged: () => void }) {
  return (
    <li className={`bg-white rounded-2xl border ${m.banned_until ? 'border-rose-200' : 'border-slate-200'}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-3.5 text-left" aria-expanded={open}>
        <span
          className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-white shrink-0 ${
            m.banned_until ? 'bg-slate-400' : 'bg-gradient-to-br from-brand-500 to-glow-500'
          }`}
        >
          {m.display_name.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-extrabold text-slate-900 truncate">{m.display_name}</span>
            {me && <Badge tone="slate">You</Badge>}
            {m.is_admin && <Badge tone="brand">Admin</Badge>}
            {m.banned_until && <Badge tone="rose">{suspendedLabel(m.banned_until)}</Badge>}
            {!m.email_confirmed_at && <Badge tone="amber">{m.invited_at ? 'Invited' : 'Unconfirmed'}</Badge>}
          </span>
          <span className="block text-sm font-semibold text-slate-500 truncate">{m.email ?? 'no email'}</span>
          <span className="block text-xs font-semibold text-slate-400">
            Joined {day(m.created_at)} · seen {ago(m.last_sign_in_at)} · {m.review_count} {m.review_count === 1 ? 'review' : 'reviews'} ·{' '}
            {m.submission_count} {m.submission_count === 1 ? 'suggestion' : 'suggestions'}
          </span>
        </span>
        <ChevronDown className={`w-5 h-5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <MemberDetail m={m} me={me} onChanged={onChanged} />}
    </li>
  );
}

interface MemberReview {
  id: string;
  rating: number;
  comment: string | null;
  is_hidden: boolean;
  created_at: string;
  venues: { id: string; name: string } | null;
}

interface MemberSubmission {
  id: string;
  kind: SubmissionKind;
  venue_name: string | null;
  message: string;
  status: SubmissionStatus;
  created_at: string;
  venues: { name: string } | null;
}

function MemberDetail({ m, me, onChanged }: { m: Member; me: boolean; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const { refreshRatings } = useDirectory();
  const [name, setName] = useState(m.display_name);
  const [suspendDays, setSuspendDays] = useState<number | null>(7);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviews, setReviews] = useState<MemberReview[] | null>(null);
  const [subs, setSubs] = useState<MemberSubmission[] | null>(null);

  const loadActivity = () => {
    supabase
      .from('reviews')
      .select('id, rating, comment, is_hidden, created_at, venues(id, name)')
      .eq('user_id', m.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setReviews((data as unknown as MemberReview[]) ?? []));
    supabase
      .from('submissions')
      .select('id, kind, venue_name, message, status, created_at, venues(name)')
      .eq('user_id', m.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setSubs((data as unknown as MemberSubmission[]) ?? []));
  };

  useEffect(() => {
    loadActivity();
  }, [m.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Runs one action with a busy flag; returns true on success. */
  const run = async (key: string, action: () => PromiseLike<{ error: { message: string } | null }>, done: string) => {
    setBusy(key);
    const { error } = await action();
    setBusy(null);
    if (error) {
      toast(error.message, 'error');
      return false;
    }
    toast(done);
    onChanged();
    return true;
  };

  const saveName = () => {
    const v = name.trim();
    if (!v || v.length > 40) return toast('Display names are 1–40 characters', 'error');
    run('name', () => supabase.from('profiles').update({ display_name: v }).eq('id', m.id), 'Display name saved');
  };

  const setAdmin = async (admin: boolean) => {
    const ok = await confirm(
      admin
        ? {
            title: `Make ${m.display_name} an admin?`,
            body: 'They’ll be able to edit every spot and event, read all suggestions and manage members, including you.',
            confirmLabel: 'Make admin',
          }
        : {
            title: `Remove ${m.display_name}’s admin access?`,
            body: 'They keep their member account and reviews.',
            confirmLabel: 'Remove access',
            danger: true,
          },
    );
    if (!ok) return;
    run('admin', () => supabase.rpc('admin_set_admin', { p_user: m.id, p_admin: admin }), admin ? 'Now an admin' : 'Admin access removed');
  };

  const suspend = async () => {
    const label = SUSPEND_FOR.find(([, d]) => d === suspendDays)?.[0].toLowerCase() ?? '';
    const ok = await confirm({
      title: `Suspend ${m.display_name} ${suspendDays ? `for ${label}` : 'indefinitely'}?`,
      body: 'They’re signed out and can’t sign in, review or rename themselves until it ends. Their existing reviews stay up; hide them below if needed.',
      confirmLabel: 'Suspend',
      danger: true,
    });
    if (!ok) return;
    // Indefinite = 100 years (the server caps it there; Auth can't store infinity).
    const until = new Date(Date.now() + (suspendDays ?? 36_500) * 86_400_000).toISOString();
    run('suspend', () => supabase.rpc('admin_suspend_user', { p_user: m.id, p_until: until }), 'Member suspended');
  };

  const unsuspend = () => run('suspend', () => supabase.rpc('admin_suspend_user', { p_user: m.id, p_until: null }), 'Suspension lifted');

  const confirmEmail = async () => {
    const ok = await confirm({
      title: 'Mark this email as confirmed?',
      body: 'Only do this if you know the address is theirs, e.g. the confirmation email never arrived.',
      confirmLabel: 'Confirm email',
    });
    if (ok) run('confirm', () => supabase.rpc('admin_confirm_user', { p_user: m.id }), 'Email confirmed — they can sign in now');
  };

  const sendReset = async () => {
    if (!m.email) return;
    const ok = await confirm({
      title: 'Send a password reset email?',
      body: `A link to choose a new password goes to ${m.email}. You never see their password.`,
      confirmLabel: 'Send email',
    });
    if (!ok) return;
    setBusy('reset');
    const { error } = await supabase.auth.resetPasswordForEmail(m.email, { redirectTo: `${window.location.origin}/account` });
    setBusy(null);
    toast(error ? error.message : 'Reset email sent', error ? 'error' : 'success');
  };

  const resendInvite = async () => {
    if (!m.email) return;
    const ok = await confirm({
      title: 'Send the invitation again?',
      body: `A fresh link goes to ${m.email}; the old one stops working.`,
      confirmLabel: 'Resend',
    });
    if (!ok) return;
    setBusy('invite');
    const r = await sendInvite({ email: m.email });
    setBusy(null);
    toast(r.error ?? 'Invitation sent again', r.error ? 'error' : 'success');
    if (!r.error) onChanged();
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${m.display_name}’s account?`,
      body: `This can’t be undone. Their profile and ${m.review_count} ${m.review_count === 1 ? 'review' : 'reviews'} are deleted; their suggestions stay in the inbox without a name attached. Suspending is reversible.`,
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (!ok) return;
    const deleted = await run('delete', () => supabase.rpc('admin_delete_user', { p_user: m.id }), 'Account deleted');
    if (deleted && m.review_count > 0) refreshRatings();
  };

  const setReviewHidden = async (r: MemberReview, hidden: boolean) => {
    const { error } = await supabase.from('reviews').update({ is_hidden: hidden }).eq('id', r.id);
    if (error) return toast(error.message, 'error');
    toast(hidden ? 'Review hidden' : 'Review visible again');
    refreshRatings();
    loadActivity();
    onChanged();
  };

  return (
    <div className="border-t border-slate-100 p-3.5 md:p-4 space-y-5">
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <dt className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Joined</dt>
          <dd className="font-bold text-slate-800">{day(m.created_at)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Last sign-in</dt>
          <dd className="font-bold text-slate-800">{ago(m.last_sign_in_at)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Email</dt>
          <dd className="font-bold text-slate-800">
            {m.email_confirmed_at ? `Confirmed ${day(m.email_confirmed_at)}` : m.invited_at ? `Invited ${ago(m.invited_at)}, not accepted` : 'Not confirmed'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">User ID</dt>
          <dd className="font-mono text-xs text-slate-600 truncate select-all" title={m.id}>
            {m.id}
          </dd>
        </div>
      </dl>

      <Field label="Display name" hint="Shown publicly on their reviews and community credits.">
        <div className="flex gap-2">
          <input className={inputClass} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <Button variant="secondary" loading={busy === 'name'} disabled={name.trim() === m.display_name} onClick={saveName}>
            Save
          </Button>
        </div>
      </Field>

      <div className="space-y-2">
        <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Account</p>
        {me ? (
          <p className="text-sm font-semibold text-slate-500">
            This is you. Another admin has to change your access, suspend or delete your account.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {m.is_admin ? (
              <Button variant="secondary" loading={busy === 'admin'} onClick={() => setAdmin(false)}>
                <ShieldOff className="w-4 h-4" /> Remove admin
              </Button>
            ) : (
              <Button variant="secondary" loading={busy === 'admin'} disabled={!!m.banned_until} onClick={() => setAdmin(true)}>
                <ShieldCheck className="w-4 h-4" /> Make admin
              </Button>
            )}
            {pendingInvite(m) && m.email && (
              <Button variant="secondary" loading={busy === 'invite'} onClick={resendInvite}>
                <Send className="w-4 h-4" /> Resend invite
              </Button>
            )}
            {!m.email_confirmed_at && !pendingInvite(m) && (
              <Button variant="secondary" loading={busy === 'confirm'} onClick={confirmEmail}>
                <MailCheck className="w-4 h-4" /> Confirm email
              </Button>
            )}
            {m.email && (
              <Button variant="secondary" loading={busy === 'reset'} onClick={sendReset}>
                <KeyRound className="w-4 h-4" /> Send password reset
              </Button>
            )}
          </div>
        )}
      </div>

      {!me && (
        <div className="space-y-2">
          <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Moderation</p>
          {m.is_admin ? (
            <p className="text-sm font-semibold text-slate-500">Remove their admin access before suspending or deleting this account.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {m.banned_until ? (
                <Button variant="secondary" loading={busy === 'suspend'} onClick={unsuspend}>
                  <Undo2 className="w-4 h-4" /> Lift suspension
                </Button>
              ) : (
                <>
                  <select
                    className={`${inputClass} max-w-44`}
                    value={suspendDays ?? ''}
                    onChange={(e) => setSuspendDays(e.target.value ? Number(e.target.value) : null)}
                    aria-label="Suspension length"
                  >
                    {SUSPEND_FOR.map(([label, d]) => (
                      <option key={label} value={d ?? ''}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary" loading={busy === 'suspend'} onClick={suspend} className="text-rose-700">
                    <Ban className="w-4 h-4" /> Suspend
                  </Button>
                </>
              )}
              <Button variant="ghost" loading={busy === 'delete'} onClick={remove} className="text-rose-600">
                <Trash2 className="w-4 h-4" /> Delete account
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
          Reviews {m.hidden_review_count > 0 && <span className="normal-case tracking-normal text-slate-400">· {m.hidden_review_count} hidden</span>}
        </p>
        {reviews === null ? (
          <Spinner />
        ) : reviews.length === 0 ? (
          <p className="text-sm font-semibold text-slate-400">No reviews.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {reviews.map((r) => (
              <li key={r.id} className={`p-3 flex items-start gap-3 ${r.is_hidden ? 'bg-slate-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars value={r.rating} size={13} />
                    {r.venues ? (
                      <Link to={`/admin/v/${r.venues.id}`} className="text-sm font-extrabold text-brand-700 hover:underline">
                        {r.venues.name}
                      </Link>
                    ) : (
                      <span className="text-sm font-bold text-slate-400">removed spot</span>
                    )}
                    {r.is_hidden && <Badge tone="slate">Hidden</Badge>}
                    <span className="text-xs font-semibold text-slate-400">{day(r.created_at)}</span>
                  </div>
                  {r.comment && <p className="mt-1 text-sm text-slate-700 line-clamp-2">{r.comment}</p>}
                </div>
                <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => setReviewHidden(r, !r.is_hidden)}>
                  {r.is_hidden ? 'Unhide' : 'Hide'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Suggestions</p>
        {subs === null ? (
          <Spinner />
        ) : subs.length === 0 ? (
          <p className="text-sm font-semibold text-slate-400">No suggestions.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {subs.map((s) => (
              <li key={s.id} className="p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-extrabold text-slate-800">{SUBMISSION_KIND_LABELS[s.kind] ?? s.kind}</span>
                  {(s.venues?.name || s.venue_name) && <span className="font-semibold text-slate-500">{s.venues?.name ?? s.venue_name}</span>}
                  <Badge tone={s.status === 'new' ? 'amber' : 'slate'}>{STATUS_LABELS[s.status] ?? s.status}</Badge>
                  <span className="text-xs font-semibold text-slate-400">{day(s.created_at)}</span>
                </div>
                {s.message && <p className="mt-1 text-sm text-slate-700 line-clamp-2">{s.message}</p>}
              </li>
            ))}
          </ul>
        )}
        {subs && subs.length > 0 && (
          <Link to="/admin/inbox" className="inline-block text-sm font-extrabold text-brand-700 hover:underline">
            Open the inbox
          </Link>
        )}
      </div>
    </div>
  );
}

/** Invite someone by email: Supabase sends the styled "Invite user" template. */
function InvitePanel({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { toast } = useFeedback();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const to = email.trim();
    const r = await sendInvite({ email: to, display_name: name.trim() || undefined, make_admin: makeAdmin });
    setBusy(false);
    if (r.error) return setError(r.error);
    toast(r.warning ?? `Invitation sent to ${to}`, r.warning ? 'error' : 'success');
    setEmail('');
    setName('');
    setMakeAdmin(false);
    onSent();
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-brand-200 shadow-sm p-4 md:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-extrabold text-slate-900">
            <Send className="w-4 h-4 text-brand-600" /> Invite someone
          </h2>
          <p className="text-sm font-semibold text-slate-500">
            They get a Nassau Nights email with a link to choose a password. The link expires after 24 hours.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Email">
          <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoFocus />
        </Field>
        <Field label="Name (optional)" hint="Greets them in the email; they can change it.">
          <input className={inputClass} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shanice" />
        </Field>
      </div>
      <label className="flex items-center gap-2.5 text-sm font-bold text-slate-700 cursor-pointer w-fit">
        <input type="checkbox" checked={makeAdmin} onChange={(e) => setMakeAdmin(e.target.checked)} className="w-4 h-4 accent-brand-600" />
        Make them an admin too
      </label>
      {makeAdmin && (
        <p className="-mt-2 text-xs font-semibold text-amber-700">They’ll be able to edit everything in this console, including members.</p>
      )}
      {error && <p className="text-sm font-bold text-rose-600">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" loading={busy}>
          <Send className="w-4 h-4" /> Send invitation
        </Button>
      </div>
    </form>
  );
}
