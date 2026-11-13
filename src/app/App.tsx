import { lazy, Suspense, useEffect } from 'react';
import { createHashRouter, Outlet, RouterProvider, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/common/Feedback';
import { Toasts } from '@/components/common/Toasts';
import { AppShell } from '@/components/layout/AppShell';
import { ApprovalSheet } from '@/components/transfers/ApprovalSheet';
import { IncomingTextSheet } from '@/components/transfers/IncomingTextSheet';
import { HomeScreen } from '@/features/home/HomeScreen';
import { useTheme } from '@/hooks/useTheme';
import { AppNotices } from './AppNotices';

// Secondary screens are split into their own chunks.
const SendScreen = lazy(() =>
  import('@/features/send/SendScreen').then((m) => ({ default: m.SendScreen })),
);
const ReceiveScreen = lazy(() =>
  import('@/features/receive/ReceiveScreen').then((m) => ({ default: m.ReceiveScreen })),
);
const PairingScreen = lazy(() =>
  import('@/features/pairing/PairingScreen').then((m) => ({ default: m.PairingScreen })),
);
const ActivityScreen = lazy(() =>
  import('@/features/history/ActivityScreen').then((m) => ({ default: m.ActivityScreen })),
);
const TransferDetailsScreen = lazy(() =>
  import('@/features/transfers/TransferDetailsScreen').then((m) => ({
    default: m.TransferDetailsScreen,
  })),
);
const DevicesScreen = lazy(() =>
  import('@/features/devices/DevicesScreen').then((m) => ({ default: m.DevicesScreen })),
);
const SettingsScreen = lazy(() =>
  import('@/features/settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })),
);
const DiagnosticsScreen = lazy(() =>
  import('@/features/settings/DiagnosticsScreen').then((m) => ({ default: m.DiagnosticsScreen })),
);
const AboutScreen = lazy(() =>
  import('@/features/settings/AboutScreen').then((m) => ({ default: m.AboutScreen })),
);

function Layout() {
  useTheme();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <AppShell>
      <AppNotices />
      <Suspense
        fallback={
          <div className="flex justify-center py-24">
            <Spinner className="size-6" label="Loading" />
          </div>
        }
      >
        <Outlet />
      </Suspense>
      <ApprovalSheet />
      <IncomingTextSheet />
      <Toasts />
    </AppShell>
  );
}

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomeScreen /> },
      { path: '/send', element: <SendScreen /> },
      { path: '/receive', element: <ReceiveScreen /> },
      { path: '/pair/show', element: <PairingScreen mode="show" key="show" /> },
      { path: '/pair/scan', element: <PairingScreen mode="scan" key="scan" /> },
      { path: '/activity', element: <ActivityScreen /> },
      { path: '/activity/:id', element: <TransferDetailsScreen /> },
      { path: '/devices', element: <DevicesScreen /> },
      { path: '/settings', element: <SettingsScreen /> },
      { path: '/settings/diagnostics', element: <DiagnosticsScreen /> },
      { path: '/settings/about', element: <AboutScreen /> },
      { path: '*', element: <HomeScreen /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
