import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from '@/utils/cx';

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('flex rounded-[10px] bg-surface-3 p-0.5', className)}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const idx = options.findIndex((x) => x.value === value);
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
                onChange(options[(idx + 1) % options.length].value);
              if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
                onChange(options[(idx - 1 + options.length) % options.length].value);
            }}
            tabIndex={selected ? 0 : -1}
            className={cx(
              'flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] px-3 text-callout font-medium transition-colors [&>svg]:size-4',
              selected ? 'bg-surface text-text shadow-sm' : 'text-text-2',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <li className="flex min-h-11 items-center gap-3 px-4">
      <label htmlFor={id} className="min-w-0 flex-1 py-3">
        <span className="block text-body text-text">{label}</span>
        {description && (
          <span className="mt-0.5 block text-footnote text-text-2">{description}</span>
        )}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40',
          checked ? 'bg-accent-fill' : 'bg-surface-3',
        )}
      >
        <span
          className={cx(
            'absolute top-[2px] left-[2px] size-[27px] rounded-full bg-white shadow transition-transform duration-200',
            checked && 'translate-x-5',
          )}
        />
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
      </button>
    </li>
  );
}

export function TextField({
  label,
  hint,
  error,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}) {
  const id = useId();
  return (
    <div className={cx('space-y-1.5', className)}>
      <label htmlFor={id} className="block px-1 text-footnote font-medium text-text-2">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={!!error || undefined}
        aria-describedby={error || hint ? `${id}-hint` : undefined}
        className={cx(
          'block min-h-11 w-full rounded-[var(--radius-control)] bg-surface px-4 text-body text-text placeholder:text-text-3',
          'outline-none ring-1 ring-separator focus:ring-2 focus:ring-accent',
          error && 'ring-danger',
        )}
        {...rest}
      />
      {(error || hint) && (
        <p
          id={`${id}-hint`}
          className={cx('px-1 text-footnote', error ? 'text-danger' : 'text-text-2')}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function TextArea({
  label,
  hideLabel,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hideLabel?: boolean }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className={cx('block px-1 text-footnote font-medium text-text-2', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <textarea
        id={id}
        className={cx(
          'block w-full resize-y rounded-[var(--radius-card)] bg-surface p-4 text-body text-text placeholder:text-text-3',
          'outline-none ring-1 ring-separator focus:ring-2 focus:ring-accent',
          className,
        )}
        {...rest}
      />
    </div>
  );
}
