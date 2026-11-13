import { ArrowDownToLine, ArrowUpFromLine, MessageSquareText, ScanLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/common/Feedback';
import { Group, Section } from '@/components/common/List';
import { ConnectedDevices } from '@/components/devices/ConnectedDevices';
import { PageHeader } from '@/components/layout/PageHeader';
import { SettingsLink } from '@/components/layout/SettingsLink';
import { TransferCard } from '@/components/transfers/TransferCard';
import { TransferRow } from '@/components/transfers/TransferRow';
import { ReceivedFiles } from '@/features/receive/ReceivedFiles';
import { selectReadyPeers, useConnectionStore } from '@/stores/connectionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ACTIVE_STATUSES, useTransferStore } from '@/stores/transferStore';
import { cx } from '@/utils/cx';
import { useShallow } from 'zustand/react/shallow';

export function HomeScreen() {
  const deviceName = useSettingsStore((s) => s.settings.deviceName);
  const ready = useConnectionStore(useShallow(selectReadyPeers));
  const live = useTransferStore((s) => s.live);
  const history = useTransferStore((s) => s.history);
  const active = Object.values(live).filter((t) => ACTIVE_STATUSES.has(t.record.status));
  const recent = history.filter((r) => !ACTIVE_STATUSES.has(r.status)).slice(0, 5);

  return (
    <div className="space-y-8">
      <PageHeader
        title="FileShare"
        subtitle={`${deviceName} · ${ready.length ? 'Ready to share' : 'Not connected'}`}
        actions={<SettingsLink />}
      />

      <div className="grid grid-cols-2 gap-3">
        <ActionTile
          to="/send"
          icon={<ArrowUpFromLine />}
          title="Send"
          detail="Files to a nearby device"
          primary
        />
        <ActionTile
          to="/receive"
          icon={<ArrowDownToLine />}
          title="Receive"
          detail="Pair and accept files"
        />
        <ActionTile
          to="/send?mode=text"
          icon={<MessageSquareText />}
          title="Share Text"
          detail="Links, notes, snippets"
        />
        <ActionTile
          to="/pair/scan"
          icon={<ScanLine />}
          title="Scan Device"
          detail="Connect by QR code"
        />
      </div>

      <Section title="Connected">
        {ready.length ? (
          <ConnectedDevices />
        ) : (
          <div className="rounded-[var(--radius-card)] bg-surface px-4 py-4">
            <p className="text-body text-text">No devices connected</p>
            <p className="mt-1 text-footnote text-text-2">
              Both devices need FileShare open on the same Wi-Fi. On the receiving device tap
              Receive › Pair New Device; on the sending device tap Scan Device.
            </p>
          </div>
        )}
      </Section>

      {active.length > 0 && (
        <Section title="In progress">
          <div className="space-y-3">
            {active.map((t) => (
              <TransferCard key={t.record.id} transfer={t} compact />
            ))}
          </div>
        </Section>
      )}

      <ReceivedFiles limit={3} />

      <Section
        title="Recent"
        action={
          recent.length > 0 && (
            <Link
              to="/activity"
              className="inline-flex min-h-11 items-center px-1 text-callout font-medium text-accent"
            >
              See All
            </Link>
          )
        }
      >
        {recent.length ? (
          <Group>
            {recent.map((r) => (
              <TransferRow key={r.id} record={r} />
            ))}
          </Group>
        ) : (
          <div className="rounded-[var(--radius-card)] bg-surface">
            <EmptyState
              icon={<ArrowUpFromLine />}
              title="No transfers yet"
              message="Files and text you send or receive will appear here. Only details are kept — never the contents."
            />
          </div>
        )}
      </Section>
    </div>
  );
}

function ActionTile({
  to,
  icon,
  title,
  detail,
  primary,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
  primary?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cx(
        'flex min-h-[6.5rem] flex-col justify-between rounded-[var(--radius-card)] p-4 transition-[filter] active:brightness-95',
        primary ? 'bg-accent-fill text-on-accent' : 'bg-surface text-text',
      )}
    >
      <span
        className={cx('[&>svg]:size-6', primary ? 'text-on-accent' : 'text-accent')}
        aria-hidden
      >
        {icon}
      </span>
      <span>
        <span className="block text-headline font-semibold">{title}</span>
        <span className={cx('block text-footnote', primary ? 'text-on-accent/85' : 'text-text-2')}>
          {detail}
        </span>
      </span>
    </Link>
  );
}
