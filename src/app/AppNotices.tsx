import { useEffect, useState } from 'react';
import { Button } from '@/components/common/Button';
import { Banner } from '@/components/common/Feedback';
import { onUpdateAvailable, applyUpdate } from './serviceWorker';

/** App-level conditions that limit what FileShare can do, shown inline (not as alerts). */
export function AppNotices() {
  const [update, setUpdate] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => onUpdateAvailable(() => setUpdate(true)), []);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const insecure = typeof window !== 'undefined' && !window.isSecureContext;
  const noWebRtc = typeof RTCPeerConnection === 'undefined';

  if (!insecure && !noWebRtc && !update) {
    // Offline is normal for FileShare: say so only once, quietly.
    return online ? null : <OfflineHint />;
  }
  return (
    <div className="space-y-3 pt-4">
      {noWebRtc && (
        <Banner tone="error" title="This browser can’t make direct connections">
          FileShare needs WebRTC. Use a current version of Safari, Chrome, Edge or Firefox.
        </Banner>
      )}
      {insecure && (
        <Banner tone="warning" title="Not a secure connection">
          FileShare was opened over plain HTTP, so the browser turns off what pairing needs
          (encryption, camera, file storage). Open FileShare from its HTTPS address.
        </Banner>
      )}
      {update && (
        <Banner
          tone="info"
          title="An update is ready"
          action={
            <Button size="sm" variant="secondary" onClick={applyUpdate}>
              Reload
            </Button>
          }
        >
          Reload when no transfers are running.
        </Banner>
      )}
    </div>
  );
}

function OfflineHint() {
  return (
    <p className="pt-4 text-center text-footnote text-text-2" role="status">
      No internet connection — that’s fine. Devices on the same Wi-Fi can still connect directly.
    </p>
  );
}
