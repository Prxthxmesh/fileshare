import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Clock,
  Info,
  Loader2,
  PauseCircle,
  Unplug,
  XCircle,
} from 'lucide-react';
import type { TransferStatus } from '@/types';
import { cx } from '@/utils/cx';

export function ProgressBar({
  value,
  label,
  tone = 'accent',
  className,
}: {
  value: number;
  label: string;
  tone?: 'accent' | 'success' | 'danger' | 'muted';
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const fills = {
    accent: 'bg-accent',
    success: 'bg-success',
    danger: 'bg-danger',
    muted: 'bg-text-3',
  };
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cx('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
    >
      <div
        className={cx('h-full rounded-full transition-[width] duration-300 ease-out', fills[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <Loader2
      className={cx('size-5 animate-spin text-text-2', className)}
      aria-hidden={!label}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}

type BannerTone = 'info' | 'warning' | 'error' | 'success';

export function Banner({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const styles: Record<BannerTone, string> = {
    info: 'bg-surface text-text',
    warning: 'bg-warning-soft text-text',
    error: 'bg-danger-soft text-text',
    success: 'bg-success-soft text-text',
  };
  const icons: Record<BannerTone, ReactNode> = {
    info: <Info className="text-accent" />,
    warning: <AlertTriangle className="text-warning" />,
    error: <XCircle className="text-danger" />,
    success: <CheckCircle2 className="text-success" />,
  };
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('flex gap-3 rounded-[var(--radius-card)] p-4', styles[tone], className)}
    >
      <span className="mt-0.5 shrink-0 [&>svg]:size-5" aria-hidden>
        {icons[tone]}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="text-callout font-semibold">{title}</p>}
        {children && <div className="text-callout text-text-2">{children}</div>}
        {action && <div className="pt-1">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  message?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-10 text-center', className)}>
      <span
        className="mb-4 flex size-14 items-center justify-center rounded-full bg-surface-2 text-text-2 [&>svg]:size-7"
        aria-hidden
      >
        {icon}
      </span>
      <p className="text-headline font-semibold text-text">{title}</p>
      {message && <p className="mt-1 max-w-sm text-callout text-text-2">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const STATUS: Record<TransferStatus, { label: string; tone: string; icon: ReactNode }> = {
  pending: { label: 'Pending', tone: 'text-text-2', icon: <Clock /> },
  'awaiting-approval': { label: 'Waiting for approval', tone: 'text-text-2', icon: <Clock /> },
  active: { label: 'In progress', tone: 'text-accent', icon: <Loader2 className="animate-spin" /> },
  paused: { label: 'Paused', tone: 'text-warning', icon: <PauseCircle /> },
  verifying: {
    label: 'Verifying',
    tone: 'text-accent',
    icon: <Loader2 className="animate-spin" />,
  },
  completed: { label: 'Completed', tone: 'text-success', icon: <CheckCircle2 /> },
  failed: { label: 'Failed', tone: 'text-danger', icon: <XCircle /> },
  cancelled: { label: 'Cancelled', tone: 'text-text-2', icon: <CircleSlash /> },
  rejected: { label: 'Declined', tone: 'text-text-2', icon: <CircleSlash /> },
  interrupted: { label: 'Interrupted', tone: 'text-warning', icon: <Unplug /> },
};

/** Status with icon + text, never color alone. */
export function StatusLabel({ status, className }: { status: TransferStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <span
      className={cx('inline-flex items-center gap-1 text-footnote font-medium', s.tone, className)}
    >
      <span className="[&>svg]:size-3.5" aria-hidden>
        {s.icon}
      </span>
      {s.label}
    </span>
  );
}
