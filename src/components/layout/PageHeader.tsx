import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Screen header: a back link (for pushed screens), a large title that
 * identifies the current location, and trailing toolbar actions.
 */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <header className="safe-top pt-2 md:pt-8">
      <div className="flex min-h-11 items-center justify-between gap-2">
        {back ? (
          <Link
            to={back.to}
            className="-ml-2 inline-flex min-h-11 items-center gap-0.5 rounded-full pr-3 pl-1 text-body text-accent active:opacity-60"
          >
            <ChevronLeft className="size-6" aria-hidden />
            {back.label}
          </Link>
        ) : (
          <span />
        )}
        {actions && <div className="-mr-2 flex items-center gap-1">{actions}</div>}
      </div>
      <h1 className="mt-1 text-title-lg font-bold text-text">{title}</h1>
      {subtitle && <p className="mt-1 text-callout text-text-2">{subtitle}</p>}
    </header>
  );
}
