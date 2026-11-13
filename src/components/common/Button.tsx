import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from '@/utils/cx';

type Variant = 'primary' | 'secondary' | 'plain' | 'destructive' | 'destructive-plain' | 'neutral';
type Size = 'lg' | 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
  block?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent-fill text-on-accent enabled:active:brightness-90 enabled:hover:brightness-105',
  secondary: 'bg-accent-soft text-accent enabled:active:brightness-95',
  neutral: 'bg-surface-2 text-text enabled:active:bg-surface-3',
  plain: 'bg-transparent text-accent enabled:active:opacity-60',
  destructive: 'bg-danger-fill text-white enabled:active:brightness-90',
  'destructive-plain': 'bg-transparent text-danger enabled:active:opacity-60',
};

// Every size keeps at least a 44×44 pt hit area (accessibility.md › Mobility).
const SIZES: Record<Size, string> = {
  lg: 'min-h-[3.25rem] px-5 text-headline font-semibold gap-2 rounded-[var(--radius-control)]',
  md: 'min-h-11 px-4 text-callout font-semibold gap-2 rounded-[var(--radius-control)]',
  sm: 'min-h-11 px-3 text-callout font-medium gap-1.5 rounded-[var(--radius-control)]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon,
    loading,
    block,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const plain = variant === 'plain' || variant === 'destructive-plain';
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex select-none items-center justify-center whitespace-nowrap transition-[filter,opacity,background-color] duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40',
        SIZES[size],
        plain && 'px-2',
        VARIANTS[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-[1.125em] animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  tone?: 'default' | 'accent' | 'danger';
}

/** Icon-only control with a required accessible label and a 44×44 hit area. */
export function IconButton({
  label,
  icon,
  tone = 'default',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors',
        'enabled:hover:bg-surface-2 enabled:active:bg-surface-3 disabled:opacity-40',
        tone === 'accent' && 'text-accent',
        tone === 'danger' && 'text-danger',
        tone === 'default' && 'text-text-2',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
