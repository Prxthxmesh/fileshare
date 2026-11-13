import { Loader2 } from 'lucide-react';
import { DeviceGlyph } from '@/components/devices/DeviceIcon';
import { useConnectDevice } from '@/hooks/usePairedDevices';
import { useNow } from '@/hooks/useNow';
import { displayName } from '@/services/storage/deviceRepository';
import { isAvailable, useLinkStore } from '@/stores/linkStore';
import type { DeviceRecord } from '@/types';
import { cx } from '@/utils/cx';

/**
 * Rows for paired devices that aren't connected. Tapping one connects through
 * quick connect (no QR) and reports the new session id.
 */
export function PairedDeviceRows({
  devices,
  onConnected,
  role,
}: {
  devices: DeviceRecord[];
  onConnected?: (sessionId: string) => void;
  role?: 'radio';
}) {
  const seen = useLinkStore((s) => s.seen);
  const connecting = useLinkStore((s) => s.connecting);
  const relays = useLinkStore((s) => s.relays);
  const now = useNow(10_000);
  const connect = useConnectDevice();

  return (
    <>
      {devices.map((d) => {
        const busy = !!connecting[d.deviceId];
        const available = isAvailable(seen[d.deviceId], now);
        const status = busy
          ? 'Connecting…'
          : available
            ? 'Available · Tap to connect'
            : relays === 0
              ? 'Quick connect offline · Tap to try'
              : 'Not seen · Open FileShare on it, then tap';
        return (
          <li key={d.deviceId}>
            <button
              type="button"
              role={role}
              aria-checked={role === 'radio' ? false : undefined}
              disabled={busy}
              onClick={async () => {
                const id = await connect(d);
                if (id) onConnected?.(id);
              }}
              className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2 disabled:opacity-70"
            >
              <span
                className="relative flex size-9 items-center justify-center rounded-[10px] bg-surface-2 text-text-2"
                aria-hidden
              >
                <DeviceGlyph kind={d.kind} className="size-[1.15rem]" />
                <span
                  className={cx(
                    'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface',
                    available ? 'bg-success' : 'bg-text-3',
                  )}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-text">{displayName(d)}</span>
                <span
                  className={cx('block text-footnote', available ? 'text-success' : 'text-text-2')}
                >
                  {status}
                </span>
              </span>
              {busy && <Loader2 className="size-5 animate-spin text-text-2" aria-hidden />}
            </button>
          </li>
        );
      })}
    </>
  );
}
