import { Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

/** Settings entry point on compact widths (the sidebar has its own on regular widths). */
export function SettingsLink() {
  return (
    <Link
      to="/settings"
      aria-label="Settings"
      title="Settings"
      className="inline-flex size-11 items-center justify-center rounded-full text-text-2 active:bg-surface-2 md:hidden"
    >
      <Settings className="size-[1.375rem]" aria-hidden />
    </Link>
  );
}
