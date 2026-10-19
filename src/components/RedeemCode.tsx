import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, QrCode, RefreshCw, X } from 'lucide-react';
import { createRedeemCode, formatCode, redeemCodeStatus, redeemUrl } from '@/lib/rewards';
import { pointsLabel } from '@/lib/points';

// ---------------------------------------------------------------------------
// The member's redeem code: a full-screen QR for staff to scan at a partner
// bar. Each code lasts 5 minutes and works once; a new one is made when it
// runs out. The screen stays awake while it's open, and it switches to
// "Redeemed!" as soon as staff confirm (polled every few seconds).
// ---------------------------------------------------------------------------

type View =
  | { kind: 'loading' }
  | { kind: 'code'; code: string; expiresAt: number; balance: number; svg: string }
  | { kind: 'used'; title: string | null; points: number | null; venue: string | null; balance: number }
  | { kind: 'error'; text: string };

const POLL_MS = 2500;

async function qrSvg(text: string) {
  // Lazy: the QR encoder only loads when someone opens their code.
  const QR = await import('qrcode');
  return QR.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0a0714', light: '#ffffff' } });
}

export function RedeemCodeSheet({ open, onClose, onRedeemed }: { open: boolean; onClose: () => void; onRedeemed?: () => void }) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [now, setNow] = useState(Date.now());
  const panel = useRef<HTMLDivElement>(null);

  const fresh = useCallback(async () => {
    setView({ kind: 'loading' });
    const r = await createRedeemCode();
    if (r.status !== 'ok') {
      setView({
        kind: 'error',
        text:
          r.status === 'suspended'
            ? 'Your account is suspended, so its points can’t be used right now.'
            : r.status === 'disabled'
              ? 'Points are paused at the moment.'
              : r.status === 'signed_out'
                ? 'Sign in to use your points.'
                : 'Couldn’t make a code. Check your connection and try again.',
      });
      return;
    }
    const svg = await qrSvg(redeemUrl(r.code));
    setView({ kind: 'code', code: r.code, expiresAt: Date.parse(r.expires_at), balance: r.balance, svg });
  }, []);

  useEffect(() => {
    if (open) fresh();
  }, [open, fresh]);

  // Countdown, then a new code when it runs out.
  useEffect(() => {
    if (!open || view.kind !== 'code') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, view.kind]);
  const expired = view.kind === 'code' && now >= view.expiresAt;
  useEffect(() => {
    if (open && expired) fresh();
  }, [open, expired, fresh]);

  // Watch for the staff's confirmation.
  const code = view.kind === 'code' ? view.code : null;
  useEffect(() => {
    if (!open || !code) return;
    let alive = true;
    const id = setInterval(async () => {
      if (document.hidden) return;
      const s = await redeemCodeStatus(code);
      if (!alive || !s) return;
      if (s.status === 'used') {
        setView({ kind: 'used', title: s.title, points: s.points, venue: s.venue, balance: s.balance });
        onRedeemed?.();
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open, code, onRedeemed]);

  // Keep the screen on while the code is up (where the browser allows it).
  useEffect(() => {
    if (!open) return;
    let lock: { release: () => Promise<void> } | null = null;
    const wake = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    wake?.request('screen').then((l) => (lock = l)).catch(() => {});
    return () => {
      lock?.release().catch(() => {});
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const left = view.kind === 'code' ? Math.max(0, Math.ceil((view.expiresAt - now) / 1000)) : 0;

  return (
    <div className="fixed inset-0 z-[3500] flex items-center justify-center p-4 bg-night-950/90 backdrop-blur-md">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Your redeem code" className="relative w-full max-w-sm outline-none">
        <button onClick={onClose} className="absolute -top-2 right-0 p-2 rounded-full text-night-200 hover:text-white hover:bg-white/10" aria-label="Close">
          <X className="w-6 h-6" />
        </button>
        <h2 className="flex items-center gap-2 pr-10 text-lg font-extrabold text-white">
          <QrCode className="w-5 h-5 text-amber-300" /> Your redeem code
        </h2>

        {view.kind === 'loading' && (
          <div className="mt-4 aspect-square rounded-3xl bg-white flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-night-700" />
          </div>
        )}

        {view.kind === 'code' && (
          <>
            <p className="mt-1 text-sm font-semibold text-night-200">Show this to staff at a participating bar. They’ll scan it and choose your reward.</p>
            <div className="mt-4 rounded-3xl bg-white p-4 shadow-2xl">
              {/* qrcode's own SVG output for our code; no user content. */}
              <div className="aspect-square [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: view.svg }} />
              <p className="mt-2 text-center font-mono text-2xl font-black tracking-[0.2em] text-night-950">{formatCode(view.code)}</p>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm font-bold">
              <span className="text-amber-300">{pointsLabel(view.balance)}</span>
              <span className="text-night-300" aria-live="polite">
                New code in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
              </span>
            </div>
            <p className="mt-2 text-xs font-semibold text-night-400">Works once, for 5 minutes. Never share a screenshot of it.</p>
          </>
        )}

        {view.kind === 'used' && (
          <div className="mt-4 rounded-3xl bg-emerald-400/10 border border-emerald-400/30 p-6 text-center">
            <CheckCircle2 className="w-14 h-14 mx-auto text-emerald-300" />
            <p className="mt-3 font-display text-2xl font-extrabold text-white">Redeemed!</p>
            {view.title && (
              <p className="mt-1 font-bold text-night-100">
                {view.title}
                {view.venue ? ` at ${view.venue}` : ''}
              </p>
            )}
            {view.points !== null && <p className="mt-1 text-sm font-semibold text-night-300">−{pointsLabel(view.points)} · {pointsLabel(view.balance)} left</p>}
            <div className="mt-5 flex gap-2 justify-center">
              <button onClick={fresh} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-extrabold">
                <RefreshCw className="w-4 h-4" /> New code
              </button>
              <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-white text-sm font-extrabold">
                Done
              </button>
            </div>
          </div>
        )}

        {view.kind === 'error' && (
          <div className="mt-4 rounded-3xl bg-white/5 border border-white/10 p-6 text-center">
            <p className="font-bold text-night-100">{view.text}</p>
            <button onClick={fresh} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-extrabold">
              <RefreshCw className="w-4 h-4" /> Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
