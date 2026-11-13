import type { ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  House,
  MonitorSmartphone,
  Settings,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { selectReadyPeers, useConnectionStore } from '@/stores/connectionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { cx } from '@/utils/cx';
import { pluralize } from '@/utils/format';
import { useShallow } from 'zustand/react/shallow';
import { BrandMark } from './BrandMark';

const NAV = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/send', label: 'Send', icon: ArrowUpFromLine },
  { to: '/receive', label: 'Receive', icon: ArrowDownToLine },
  { to: '/activity', label: 'Activity', icon: History },
  { to: '/devices', label: 'Devices', icon: MonitorSmartphone },
] as const;

/**
 * Navigation follows tab-bars.md: on compact widths a bottom tab bar with five
 * single-word tabs that is always visible; on regular widths (iPad, desktop)
 * the same sections appear in a sidebar, plus Settings.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const modal = pathname.startsWith('/pair');
  return (
    <div className="min-h-dvh md:flex">
      {!modal && <Sidebar />}
      <main id="main" className={cx('min-w-0 flex-1', !modal && 'pb-tabbar')}>
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 md:px-10">{children}</div>
      </main>
      {!modal && <TabBar />}
    </div>
  );
}

function Sidebar() {
  const deviceName = useSettingsStore((s) => s.settings.deviceName);
  const ready = useConnectionStore(useShallow(selectReadyPeers));
  return (
    <nav
      aria-label="Main"
      className="safe-top sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-separator bg-surface md:flex lg:w-72"
    >
      <div className="flex items-center gap-2.5 px-5 pt-7 pb-6">
        <BrandMark size={30} />
        <span className="text-headline font-semibold text-text">FileShare</span>
      </div>
      <ul className="flex-1 space-y-0.5 px-3">
        {[...NAV, { to: '/settings', label: 'Settings', icon: Settings, end: false }].map(
          ({ to, label, icon: Icon, ...rest }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={'end' in rest ? rest.end : false}
                className={({ isActive }) =>
                  cx(
                    'flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-body transition-colors',
                    isActive
                      ? 'bg-accent-soft font-semibold text-accent'
                      : 'text-text hover:bg-surface-2',
                  )
                }
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </NavLink>
            </li>
          ),
        )}
      </ul>
      <div className="m-3 rounded-[var(--radius-card)] bg-bg p-4">
        <p className="truncate text-footnote font-semibold text-text">{deviceName}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-footnote text-text-2">
          <span
            className={cx(
              'inline-block size-2 rounded-full',
              ready.length ? 'bg-success' : 'bg-text-3',
            )}
            aria-hidden
          />
          {ready.length
            ? `Connected to ${pluralize(ready.length, 'device')}`
            : 'No devices connected'}
        </p>
      </div>
    </nav>
  );
}

function TabBar() {
  return (
    <nav
      aria-label="Main"
      className="safe-bottom hairline-t fixed inset-x-0 bottom-0 z-30 bg-surface/95 backdrop-blur-md md:hidden"
    >
      <ul className="mx-auto flex max-w-xl">
        {NAV.map(({ to, label, icon: Icon, ...rest }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={'end' in rest ? rest.end : false}
              className={({ isActive }) =>
                cx(
                  'flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-[0.6875rem] leading-tight',
                  isActive ? 'font-semibold text-accent' : 'font-medium text-text-2',
                )
              }
            >
              <Icon className="size-6" aria-hidden strokeWidth={1.9} />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
