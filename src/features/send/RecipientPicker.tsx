import { useEffect } from 'react';
import { Check, ScanLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Section } from '@/components/common/List';
import { DeviceGlyph } from '@/components/devices/DeviceIcon';
import { PairedDeviceRows } from '@/components/devices/PairedDevices';
import { usePairedOffline } from '@/hooks/usePairedDevices';
import { selectReadyPeers, useConnectionStore } from '@/stores/connectionStore';
import { cx } from '@/utils/cx';
import { useShallow } from 'zustand/react/shallow';

/**
 * Who to send to: connected devices (select) and paired devices that aren't
 * connected right now (tap to connect via quick connect, then selected).
 */
export function RecipientPicker({
  value,
  onChange,
  next,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  next: string;
}) {
  const peers = useConnectionStore(useShallow(selectReadyPeers));
  const paired = usePairedOffline();

  // Keep the selection valid: auto-select the only device, drop a device that disconnected.
  useEffect(() => {
    if (value && !peers.some((p) => p.id === value)) onChange(peers[0]?.id ?? null);
    else if (!value && peers.length === 1) onChange(peers[0].id);
  }, [peers, value, onChange]);

  const scanLink = `/pair/scan?next=${encodeURIComponent(next)}`;

  if (!peers.length && !paired.length) {
    return (
      <Section title="To">
        <div className="rounded-[var(--radius-card)] bg-surface p-4">
          <p className="text-body text-text">No device connected</p>
          <p className="mt-1 text-footnote text-text-2">
            Scan the pairing code on the receiving device once. After that it appears here and
            connects with a tap.
          </p>
          <Link
            to={scanLink}
            className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-accent-fill px-4 text-callout font-semibold text-on-accent active:brightness-90"
          >
            <ScanLine className="size-5" aria-hidden /> Scan Device
          </Link>
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="To"
      action={
        <Link
          to={scanLink}
          className="inline-flex min-h-11 items-center px-1 text-callout font-medium text-accent"
        >
          Pair New
        </Link>
      }
      footer={
        paired.length > 0
          ? 'Your paired devices connect with a tap when FileShare is open on them.'
          : undefined
      }
    >
      <div
        role="radiogroup"
        aria-label="Recipient"
        className="overflow-hidden rounded-[var(--radius-card)] bg-surface"
      >
        <ul className="divide-y divide-separator">
          {peers.map((p) => {
            const selected = p.id === value;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChange(p.id)}
                  className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2"
                >
                  <span
                    className="relative flex size-9 items-center justify-center rounded-[10px] bg-surface-2 text-text-2"
                    aria-hidden
                  >
                    <DeviceGlyph kind={p.remote?.kind ?? 'unknown'} className="size-[1.15rem]" />
                    <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-success ring-2 ring-surface" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-text">{p.remote?.name}</span>
                    <span className="block text-footnote text-text-2">
                      {p.phase === 'unstable' ? 'Connection unstable' : 'Connected'}
                    </span>
                  </span>
                  <Check
                    className={cx('size-5 text-accent', !selected && 'invisible')}
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
          <PairedDeviceRows devices={paired} onConnected={onChange} role="radio" />
        </ul>
      </div>
    </Section>
  );
}
