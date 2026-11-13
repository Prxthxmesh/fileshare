import { useEffect } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useUiStore, type Toast } from '@/stores/uiStore';
import { cx } from '@/utils/cx';

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUiStore((s) => s.dismissToast);
  useEffect(() => {
    // Errors stay until dismissed; confirmations fade after a few seconds.
    if (toast.tone === 'error') return;
    const timer = window.setTimeout(() => dismiss(toast.id), 5000);
    return () => window.clearTimeout(timer);
  }, [toast, dismiss]);
  const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? XCircle : Info;
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full animate-toast-in items-start gap-3 rounded-[var(--radius-card)] bg-surface p-3 pl-4 shadow-[var(--shadow-sheet)]"
    >
      <Icon
        aria-hidden
        className={cx(
          'mt-0.5 size-5 shrink-0',
          toast.tone === 'success' && 'text-success',
          toast.tone === 'error' && 'text-danger',
          toast.tone === 'neutral' && 'text-accent',
        )}
      />
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-callout font-semibold text-text">{toast.title}</p>
        {toast.message && <p className="mt-0.5 text-footnote text-text-2">{toast.message}</p>}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss"
        className="-my-1 -mr-1 flex size-11 shrink-0 items-center justify-center rounded-full text-text-3 active:bg-surface-2"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(0.5rem+env(safe-area-inset-top))] z-40 flex flex-col items-center gap-2 px-4 md:top-auto md:bottom-6 md:left-auto md:right-6 md:w-96 md:items-end md:px-0"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
