import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Toasts + confirm dialog (no window.alert/confirm — they block on mobile and
// look out of place in an installed app).
// ---------------------------------------------------------------------------

type ToastKind = 'success' | 'error';
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}
interface ConfirmState {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const FeedbackContext = createContext<{
  toast: (text: string, kind?: ToastKind) => void;
  confirm: (opts: Omit<ConfirmState, 'resolve'>) => Promise<boolean>;
} | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2600);
  }, []);

  const confirm = useCallback(
    (opts: Omit<ConfirmState, 'resolve'>) => new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve })),
    [],
  );

  const close = (ok: boolean) => {
    confirmState?.resolve(ok);
    setConfirmState(null);
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      {createPortal(
        <div className="fixed top-4 inset-x-0 z-[6000] flex flex-col items-center gap-2 pointer-events-none px-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl text-sm font-bold max-w-md ${
                t.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'
              }`}
            >
              {t.kind === 'error' ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />}
              {t.text}
            </div>
          ))}
        </div>,
        document.body,
      )}
      {confirmState &&
        createPortal(
          <div className="fixed inset-0 z-[6000] flex items-end sm:items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => close(false)} />
            <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6">
              <h3 className="text-lg font-extrabold text-slate-900">{confirmState.title}</h3>
              {confirmState.body && <p className="mt-1.5 text-sm text-slate-600 font-semibold">{confirmState.body}</p>}
              <div className="mt-5 flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => close(false)}>
                  Cancel
                </Button>
                <Button variant={confirmState.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
                  {confirmState.confirmLabel ?? 'Confirm'}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used inside <FeedbackProvider>');
  return ctx;
}

// ---------------------------------------------------------------------------
// Form primitives
// ---------------------------------------------------------------------------

export const inputClass =
  'w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-[15px] font-semibold text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 placeholder:text-slate-400 placeholder:font-medium';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400 font-semibold mt-1">{hint}</span>}
    </label>
  );
}

export function Panel({ title, action, children, id }: { title: string; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="bg-white rounded-2xl border border-slate-200 shadow-sm scroll-mt-20">
      <div className="flex items-center justify-between gap-3 px-4 md:px-5 py-3.5 border-b border-slate-100">
        <h2 className="font-extrabold text-slate-900">{title}</h2>
        {action}
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
  secondary: 'bg-white text-slate-800 border border-slate-200 hover:bg-slate-50',
  ghost: 'text-slate-700 hover:bg-slate-100',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
};

export function Button({
  variant = 'primary',
  loading,
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-extrabold transition-colors disabled:opacity-50 active:scale-[0.98] ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="w-full flex items-center justify-between gap-4 text-left">
      <span>
        <span className="block font-extrabold text-slate-900">{label}</span>
        {hint && <span className="block text-xs font-semibold text-slate-500">{hint}</span>}
      </span>
      <span className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${checked ? 'bg-brand-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </span>
    </button>
  );
}
