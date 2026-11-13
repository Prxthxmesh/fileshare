import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '@/utils/cx';
import { Button, IconButton } from './Button';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Modal sheet: a bottom sheet on compact widths and a centered dialog on
 * regular widths. Traps focus, closes on Escape, restores focus on close,
 * and always has a visible way out (modality.md: an obvious way to dismiss).
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
  size?: 'md' | 'lg';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first =
      node?.querySelector<HTMLElement>('[data-autofocus]') ??
      node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === 'Tab' && node) {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (el) => el.offsetParent !== null,
        );
        if (!items.length) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, dismissible]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div
        className="absolute inset-0 animate-fade-in bg-[var(--backdrop)]"
        aria-hidden
        onClick={dismissible ? onClose : undefined}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx(
          'relative flex max-h-[92dvh] w-full animate-sheet-up flex-col bg-bg shadow-[var(--shadow-sheet)] outline-none',
          'rounded-t-[var(--radius-sheet)] md:rounded-[var(--radius-sheet)]',
          size === 'md' ? 'md:max-w-[30rem]' : 'md:max-w-[40rem]',
        )}
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-surface-3 md:hidden" aria-hidden />
        <header className="flex items-start gap-2 px-5 pt-3 pb-2 md:pt-5">
          <div className="min-w-0 flex-1 pt-2">
            <h2 id={titleId} className="text-title font-semibold text-text">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-callout text-text-2">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <IconButton
              label="Close"
              icon={<X className="size-5" />}
              onClick={onClose}
              className="-mr-2"
            />
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <footer className="safe-bottom hairline-t px-5 pt-3 pb-4 md:pb-5">{footer}</footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Alert-style confirmation for destructive or irreversible actions. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="neutral" onClick={onCancel} data-autofocus>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    />
  );
}
