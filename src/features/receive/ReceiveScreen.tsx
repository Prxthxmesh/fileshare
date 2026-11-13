import { QrCode } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Section } from '@/components/common/List';
import { ConnectedDevices } from '@/components/devices/ConnectedDevices';
import { PageHeader } from '@/components/layout/PageHeader';
import { SettingsLink } from '@/components/layout/SettingsLink';
import { TransferCard } from '@/components/transfers/TransferCard';
import { selectReadyPeers, useConnectionStore } from '@/stores/connectionStore';
import { ACTIVE_STATUSES, useTransferStore } from '@/stores/transferStore';
import { useShallow } from 'zustand/react/shallow';
import { ReceivedFiles } from './ReceivedFiles';

export function ReceiveScreen() {
  const ready = useConnectionStore(useShallow(selectReadyPeers));
  const live = useTransferStore((s) => s.live);
  const incoming = Object.values(live).filter(
    (t) => t.record.direction === 'receive' && ACTIVE_STATUSES.has(t.record.status),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Receive"
        subtitle={
          ready.length
            ? 'Ready. You’ll be asked before any files are accepted.'
            : 'Pair with the device that has the files.'
        }
        actions={<SettingsLink />}
      />

      <section className="rounded-[var(--radius-card)] bg-surface p-5">
        <div className="flex items-start gap-4">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-accent-soft text-accent"
            aria-hidden
          >
            <QrCode className="size-6" />
          </span>
          <div className="min-w-0">
            <h2 className="text-headline font-semibold text-text">Pair a new device</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-callout text-text-2 marker:text-text-3">
              <li>Show your code to the other device.</li>
              <li>On that device, tap Send › Scan Device and scan it.</li>
              <li>Scan the reply it shows, then confirm the six-digit code matches.</li>
            </ol>
          </div>
        </div>
        <Link
          to="/pair/show"
          className="mt-5 flex min-h-[3.25rem] w-full items-center justify-center rounded-[var(--radius-control)] bg-accent-fill px-5 text-headline font-semibold text-on-accent active:brightness-90"
        >
          Pair New Device
        </Link>
      </section>

      {ready.length > 0 && (
        <Section title="Connected" footer="Incoming files from these devices need your approval.">
          <ConnectedDevices />
        </Section>
      )}

      {incoming.length > 0 && (
        <Section title="Receiving">
          <div className="space-y-3">
            {incoming.map((t) => (
              <TransferCard key={t.record.id} transfer={t} />
            ))}
          </div>
        </Section>
      )}

      <ReceivedFiles />
    </div>
  );
}
