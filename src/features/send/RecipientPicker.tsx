import { useEffect } from 'react';
import { Check, ScanLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Section } from '@/components/common/List';
import { DeviceGlyph } from '@/components/devices/DeviceIcon';
import { selectReadyPeers, useConnectionStore } from '@/stores/connectionStore';
import { cx } from '@/utils/cx';
import { useShallow } from 'zustand/react/shallow';

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

  // Keep the selection valid: auto-select the only device, drop a device that disconnected.
  useEffect(() => {
    if (value && !peers.some((p) => p.id === value)) onChange(peers[0]?.id ?? null);
    else if (!value && peers.length === 1) onChange(peers[0].id);
  }, [peers, value, onChange]);

  if (!peers.length) {
    return (
      <Section title="To">
        <div className="rounded-[var(--radius-card)] bg-surface p-4">
          <p className="text-body text-text">No device connected</p>
          <p className="mt-1 text-footnote text-text-2">
            Scan the pairing code on the receiving device to connect. Both devices must be on the
            same Wi-Fi.
          </p>
          <Link
            to={`/pair/scan?next=${encodeURIComponent(next)}`}
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
          to={`/pair/scan?next=${encodeURIComponent(next)}`}
          className="inline-flex min-h-11 items-center px-1 text-callout font-medium text-accent"
        >
          Add Device
        </Link>
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
                    className="flex size-9 items-center justify-center rounded-[10px] bg-surface-2 text-text-2"
                    aria-hidden
                  >
                    <DeviceGlyph kind={p.remote?.kind ?? 'unknown'} className="size-[1.15rem]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-text">{p.remote?.name}</span>
                    <span className="block text-footnote text-text-2">
                      {p.remote?.platform} ·{' '}
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
        </ul>
      </div>
    </Section>
  );
}
