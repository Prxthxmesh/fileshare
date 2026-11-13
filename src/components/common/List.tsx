import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cx } from '@/utils/cx';

/** Inset grouped section, the base surface for lists and settings. */
export function Section({
  title,
  footer,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  footer?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('space-y-2', className)}>
      {(title || action) && (
        <div className="flex min-h-8 items-center justify-between gap-3 px-1">
          {title && (
            <h2 className="text-footnote font-semibold uppercase tracking-wide text-text-2">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
      {footer && <p className="px-1 text-footnote text-text-2">{footer}</p>}
    </section>
  );
}

export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-hidden rounded-[var(--radius-card)] bg-surface', className)}>
      <ul className="divide-y divide-separator">{children}</ul>
    </div>
  );
}

export interface RowProps {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  to?: string;
  onClick?: () => void;
  chevron?: boolean;
  className?: string;
  label?: string;
}

/** List row. Becomes a link or button when `to`/`onClick` is given; minimum height 44 pt. */
export function Row({
  leading,
  title,
  subtitle,
  trailing,
  to,
  onClick,
  chevron,
  className,
  label,
}: RowProps) {
  const content = (
    <>
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1 py-3">
        <span className="block truncate text-body text-text">{title}</span>
        {subtitle && <span className="mt-0.5 block text-footnote text-text-2">{subtitle}</span>}
      </span>
      {trailing && (
        <span className="flex shrink-0 items-center gap-1 text-callout text-text-2">
          {trailing}
        </span>
      )}
      {(chevron ?? !!(to || onClick)) && (
        <ChevronRight className="size-4 shrink-0 text-text-3" aria-hidden />
      )}
    </>
  );
  const base = cx('flex min-h-11 w-full items-center gap-3 px-4 text-left', className);
  if (to) {
    return (
      <li>
        <Link to={to} className={cx(base, 'active:bg-surface-2')} aria-label={label}>
          {content}
        </Link>
      </li>
    );
  }
  if (onClick) {
    return (
      <li>
        <button
          type="button"
          onClick={onClick}
          className={cx(base, 'active:bg-surface-2')}
          aria-label={label}
        >
          {content}
        </button>
      </li>
    );
  }
  return <li className={base}>{content}</li>;
}

/** Rounded-square icon tile used as a row's leading element. */
export function IconTile({
  icon,
  tone = 'neutral',
}: {
  icon: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warning';
}) {
  const tones = {
    neutral: 'bg-surface-2 text-text-2',
    accent: 'bg-accent-soft text-accent',
    success: 'bg-success-soft text-success',
    danger: 'bg-danger-soft text-danger',
    warning: 'bg-warning-soft text-warning',
  };
  return (
    <span
      className={cx(
        'flex size-9 items-center justify-center rounded-[10px] [&>svg]:size-[1.15rem]',
        tones[tone],
      )}
      aria-hidden
    >
      {icon}
    </span>
  );
}
