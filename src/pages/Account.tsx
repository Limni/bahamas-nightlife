import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, KeyRound, Loader2, LogOut, MailCheck, MessageSquarePlus, PartyPopper, Pencil, Shield, Star, Store, XCircle } from 'lucide-react';
import { authLinkError, supabase, supabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { SUBMISSION_KIND_LABELS, type SubmissionKind, type SubmissionStatus } from '@/lib/types';
import { SetupNotice } from '@/components/SetupNotice';
import { SafeImg, Spinner, Stars } from '@/components/ui';
import { ActivitySharingToggle } from '@/components/ActivityConsent';

const input =
  'w-full px-4 py-3 rounded-2xl border border-white/10 bg-night-950/70 outline-none focus:border-brand-400 font-semibold text-white placeholder:text-night-500';
const primary =
  'w-full py-3.5 rounded-2xl font-extrabold text-white bg-gradient-to-r from-brand-500 to-glow-500 hover:brightness-110 glow-brand disabled:opacity-60 flex items-center justify-center gap-2';

/** Only allow in-app return paths (never an external URL). */
const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : null);

function AuthCard({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="w-full max-w-md mx-auto px-4 py-10">
      <div className="bg-night-900 rounded-[2rem] border border-white/10 shadow-[0_16px_48px_rgba(0,0,0,0.5)] p-6 md:p-8">
        <h1 className="font-display text-2xl md:text-3xl font-extrabold text-white">{title}</h1>
        {subtitle && <p className="mt-1.5 text-night-200 font-medium">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function SignedOut() {
  const { signIn, signUp, sendReset } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>(params.get('mode') === 'signup' ? 'signup' : 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<'confirm' | 'reset' | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    if (mode === 'signin') {
      const err = await signIn(email, password);
      setBusy(false);
      if (err) return setError(err);
      if (next) navigate(next, { replace: true });
    } else if (mode === 'signup') {
      if (name.trim().length < 2) {
        setBusy(false);
        return setError('Add the name you’d like shown on your reviews.');
      }
      if (password.length < 8) {
        setBusy(false);
        return setError('Use at least 8 characters for your password.');
      }
      const { error: err, needsConfirm } = await signUp(name, email, password);
      setBusy(false);
      if (err) return setError(err);
      if (needsConfirm) setSent('confirm');
      else if (next) navigate(next, { replace: true });
    } else {
      const err = await sendReset(email);
      setBusy(false);
      if (err) return setError(err);
      setSent('reset');
    }
  };

  if (sent) {
    return (
      <AuthCard title="Check your email" subtitle={sent === 'confirm' ? `We sent a confirmation link to ${email}.` : `We sent a password reset link to ${email}.`}>
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-glow-500/10 border border-glow-400/25 text-sm font-semibold text-night-50">
          <MailCheck className="w-5 h-5 text-glow-300 shrink-0" />
          {sent === 'confirm'
            ? 'Tap the link to activate your account — then you can rate spots and leave reviews.'
            : 'Tap the link to choose a new password. It opens this site.'}
        </div>
        <button onClick={() => { setSent(null); setMode('signin'); }} className="mt-5 text-sm font-extrabold text-brand-300 hover:text-night-100">
          ← Back to sign in
        </button>
      </AuthCard>
    );
  }

  const titles = {
    signin: ['Welcome back', 'Sign in to rate spots, leave reviews and follow your suggestions.'],
    signup: ['Join Nassau Nights', 'Rate the spots you love, review your nights out and help keep listings fresh.'],
    forgot: ['Reset your password', 'We’ll email you a link to choose a new one.'],
  } as const;

  return (
    <AuthCard title={titles[mode][0]} subtitle={titles[mode][1]}>
      {mode !== 'forgot' && (
        <div className="grid grid-cols-2 gap-1 p-1 mb-5 rounded-2xl bg-white/5">
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null); }}
              className={`py-2.5 rounded-xl text-sm font-extrabold transition-colors ${mode === m ? 'bg-brand-500 text-white' : 'text-night-200'}`}
            >
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        {mode === 'signup' && (
          <input className={input} placeholder="Your name (shown on reviews)" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="nickname" required />
        )}
        <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        {mode !== 'forgot' && (
          <input
            className={input}
            type="password"
            placeholder={mode === 'signup' ? 'Password (8+ characters)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
          />
        )}
        {error && <p className="text-sm font-bold text-brand-200 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">{error}</p>}
        <button type="submit" disabled={busy || !supabaseConfigured} className={primary}>
          {busy && <Loader2 className="w-5 h-5 animate-spin" />}
          {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>
      </form>
      <div className="mt-4 text-center text-sm font-bold">
        {mode === 'signin' ? (
          <button onClick={() => { setMode('forgot'); setError(null); }} className="text-brand-300 hover:text-night-100">
            Forgot your password?
          </button>
        ) : mode === 'forgot' ? (
          <button onClick={() => { setMode('signin'); setError(null); }} className="text-brand-300 hover:text-night-100">
            ← Back to sign in
          </button>
        ) : (
          <span className="text-night-300 font-semibold">Only your name is shown publicly — never your email.</span>
        )}
      </div>
    </AuthCard>
  );
}

/** After a reset link; or, with `welcome`, the first stop after accepting an invitation. */
function NewPassword({ welcome = false }: { welcome?: boolean }) {
  const { updatePassword, updateName, profile } = useAuth();
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The name the admin typed on the invite arrives with the profile.
  useEffect(() => {
    if (profile && !nameTouched) setName(profile.display_name === 'Member' ? '' : profile.display_name);
  }, [profile, nameTouched]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (welcome && !name.trim()) return setError('Tell us what to call you.');
    if (password.length < 8) return setError('Use at least 8 characters.');
    setBusy(true);
    if (welcome && name.trim() !== profile?.display_name) {
      const nameErr = await updateName(name.trim().slice(0, 40));
      if (nameErr) {
        setBusy(false);
        return setError(nameErr);
      }
    }
    const err = await updatePassword(password);
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <AuthCard
      title={welcome ? 'Welcome to Nassau Nights' : 'Choose a new password'}
      subtitle={welcome ? 'You’re in. Pick a name and a password to finish setting up your account.' : undefined}
    >
      {welcome && (
        <div className="mb-4 flex items-center gap-3 p-3 rounded-2xl bg-brand-500/10 border border-brand-400/30 text-sm font-semibold text-brand-100">
          <PartyPopper className="w-5 h-5 text-brand-300 shrink-0" /> Your invitation has been accepted.
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        {welcome && (
          <input
            className={input}
            placeholder="Your name (shown on your reviews)"
            value={name}
            maxLength={40}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
            autoComplete="nickname"
          />
        )}
        <input className={input} type="password" placeholder={welcome ? 'Password (8+ characters)' : 'New password (8+ characters)'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus={!welcome} />
        {error && <p className="text-sm font-bold text-brand-200">{error}</p>}
        <button type="submit" disabled={busy} className={primary}>
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />} {welcome ? 'Finish setting up' : 'Save password'}
        </button>
      </form>
    </AuthCard>
  );
}

interface MyReview {
  id: string;
  rating: number;
  comment: string | null;
  is_hidden: boolean;
  updated_at: string;
  venues: { name: string; slug: string } | null;
}
interface ManagedVenue {
  id: string;
  name: string;
  slug: string;
  area: string | null;
  cover_url: string | null;
  is_published: boolean;
}
interface MySubmission {
  id: string;
  kind: SubmissionKind;
  venue_name: string | null;
  message: string;
  status: SubmissionStatus;
  created_at: string;
}

const STATUS: Record<SubmissionStatus, { label: string; className: string; icon: typeof Clock }> = {
  new: { label: 'Received', className: 'bg-glow-500/15 text-glow-200', icon: Clock },
  reviewing: { label: 'In progress', className: 'bg-sky-400/15 text-sky-200', icon: Clock },
  done: { label: 'Applied — thank you!', className: 'bg-emerald-400/15 text-emerald-400', icon: CheckCircle2 },
  dismissed: { label: 'Not applied', className: 'bg-white/10 text-night-300', icon: XCircle },
};

function SignedIn() {
  const { session, profile, isAdmin, updateName, signOut } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [reviews, setReviews] = useState<MyReview[] | null>(null);
  const [subs, setSubs] = useState<MySubmission[] | null>(null);
  const [managed, setManaged] = useState<ManagedVenue[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);

  // Arrived via "sign in to review" → go straight back once signed in.
  useEffect(() => {
    const next = safeNext(params.get('next'));
    if (next) navigate(next, { replace: true });
  }, [params, navigate]);

  useEffect(() => {
    if (!session) return;
    supabase
      .from('reviews')
      .select('id, rating, comment, is_hidden, updated_at, venues(name, slug)')
      .eq('user_id', session.user.id)
      .order('updated_at', { ascending: false })
      .then(({ data }) => setReviews((data as unknown as MyReview[]) ?? []));
    supabase.rpc('my_submissions').then(({ data }) => setSubs((data as MySubmission[]) ?? []));
    // Venues an admin has made this member a manager of (usually none).
    supabase
      .from('venue_managers')
      .select('venues(id, name, slug, area, cover_url, is_published)')
      .eq('user_id', session.user.id)
      .then(({ data }) =>
        setManaged(
          ((data ?? []) as unknown as { venues: ManagedVenue | null }[])
            .map((r) => r.venues)
            .filter((v): v is ManagedVenue => !!v)
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      );
  }, [session]);

  const saveName = async () => {
    if (name.trim().length < 2) return setNameError('At least 2 characters.');
    const err = await updateName(name);
    if (err) return setNameError(err);
    setEditing(false);
    setNameError(null);
  };

  const displayName = profile?.display_name ?? '…';

  return (
    <div className="w-full max-w-3xl mx-auto px-4 md:px-6 py-8 space-y-6">
      <section className="neon-board rounded-[2rem] text-white p-6 md:p-8 flex flex-col sm:flex-row sm:items-center gap-5">
        <span className="w-16 h-16 rounded-full bg-brand-500 ring-4 ring-white/15 flex items-center justify-center font-display text-3xl font-extrabold shrink-0">
          {displayName.charAt(0).toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex flex-wrap gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && saveName()}
                className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-night-950/70 border border-white/15 text-white font-bold outline-none focus:border-brand-400"
              />
              <button onClick={saveName} className="px-4 py-2 rounded-xl bg-glow-400 text-night-950 font-extrabold">Save</button>
              <button onClick={() => setEditing(false)} className="px-3 py-2 rounded-xl text-white/80 font-bold">Cancel</button>
              {nameError && <p className="w-full text-sm font-bold text-glow-200">{nameError}</p>}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl md:text-3xl font-extrabold truncate">{displayName}</h1>
              <button onClick={() => { setName(profile?.display_name ?? ''); setEditing(true); }} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10" aria-label="Edit display name">
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}
          <p className="text-sm font-semibold text-white/65 truncate">{session?.user.email} · only your name is public</p>
        </div>
        <div className="flex sm:flex-col gap-2">
          {isAdmin && (
            <Link to="/admin" className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-extrabold">
              <Shield className="w-4 h-4" /> Admin console
            </Link>
          )}
          <button onClick={signOut} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-extrabold">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </section>

      {managed.length > 0 && (
        <section className="bg-night-900 rounded-[1.75rem] border border-glow-400/30 p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="flex items-center gap-2 font-display text-xl font-bold text-white">
              <Store className="w-5 h-5 text-glow-300" /> Venue manager
            </h2>
            <Link to="/manage" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-brand-500 to-glow-500 text-white text-sm font-extrabold glow-brand-soft">
              Open venue manager <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <p className="text-sm font-semibold text-night-300 mb-3">
            Update your listing{managed.length > 1 ? 's' : ''}: details, hours, photos, drinks and food menus, and events.
          </p>
          <ul className="grid sm:grid-cols-2 gap-2">
            {managed.map((v) => (
              <li key={v.id}>
                <Link to={`/manage/v/${v.id}`} className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10">
                  <span className="w-12 h-12 rounded-xl overflow-hidden bg-white/5 shrink-0">
                    <SafeImg src={v.cover_url} name={v.name} className="w-full h-full" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-extrabold text-white truncate">{v.name}</span>
                    <span className="block text-xs font-semibold text-night-300 truncate">
                      {v.is_published ? 'Live' : 'Draft'}
                      {v.area ? ` · ${v.area}` : ''}
                    </span>
                  </span>
                  <Pencil className="w-4 h-4 text-night-300 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-night-900 rounded-[1.75rem] border border-white/10 p-5 md:p-6">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold text-white mb-4">
          <Star className="w-5 h-5 text-amber-400" /> My reviews
        </h2>
        {reviews === null ? (
          <Spinner />
        ) : reviews.length === 0 ? (
          <p className="text-sm font-semibold text-night-300">
            You haven’t reviewed anywhere yet. Find a spot you’ve been out at and rate it on its <b>Reviews</b> tab.{' '}
            <Link to="/" className="text-brand-300 font-extrabold">Explore spots →</Link>
          </p>
        ) : (
          <ul className="divide-y divide-white/10">
            {reviews.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <Link to={r.venues ? `/v/${r.venues.slug}?tab=reviews` : '#'} className="font-display font-bold text-white hover:text-brand-200 truncate">
                    {r.venues?.name ?? 'Removed spot'}
                  </Link>
                  <Stars value={r.rating} size={15} />
                </div>
                {r.comment && <p className="text-sm text-night-200 mt-1 line-clamp-2">{r.comment}</p>}
                {r.is_hidden && <p className="text-xs font-bold text-brand-300 mt-1">Hidden by a moderator</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-night-900 rounded-[1.75rem] border border-white/10 p-5 md:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="flex items-center gap-2 font-display text-xl font-bold text-white">
            <MessageSquarePlus className="w-5 h-5 text-brand-400" /> My suggestions
          </h2>
          <Link to="/community" className="text-sm font-extrabold text-brand-300 hover:text-night-100">New suggestion →</Link>
        </div>
        {subs === null ? (
          <Spinner />
        ) : subs.length === 0 ? (
          <p className="text-sm font-semibold text-night-300">Suggestions you send while signed in show up here, with their status.</p>
        ) : (
          <ul className="space-y-3">
            {subs.map((s) => {
              const st = STATUS[s.status];
              return (
                <li key={s.id} className="p-3.5 rounded-2xl border border-white/10 bg-night-950/50">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-extrabold text-white">
                      {SUBMISSION_KIND_LABELS[s.kind]}
                      {s.venue_name && <span className="font-semibold text-night-200"> · {s.venue_name}</span>}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-extrabold ${st.className}`}>
                      <st.icon className="w-3.5 h-3.5" /> {st.label}
                    </span>
                  </div>
                  <p className="text-sm text-night-200 mt-1 line-clamp-2">{s.message}</p>
                  <p className="text-xs font-semibold text-night-400 mt-1">
                    {new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ActivitySharingToggle />
    </div>
  );
}

export default function Account() {
  const { session, loading, recovering, invited } = useAuth();
  if (!supabaseConfigured) return <SetupNotice />;
  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }
  if (recovering) return <NewPassword />;
  if (invited && session) return <NewPassword welcome />;
  if (session) return <SignedIn />;
  return (
    <>
      {authLinkError && (
        <div className="w-full max-w-md mx-auto px-4 pt-8 -mb-4">
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-400/10 border border-amber-400/30 text-sm font-semibold text-amber-100">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <span>
              That email link has expired or was already used. If it was an invitation, ask for a new one, or use “Forgot your password?” below with the
              same email.
            </span>
          </div>
        </div>
      )}
      <SignedOut />
      <div className="w-full max-w-md mx-auto px-4 pb-10">
        <ActivitySharingToggle />
      </div>
    </>
  );
}
