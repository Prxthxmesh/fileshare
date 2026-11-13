import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { SegmentedControl } from '@/components/common/Controls';
import { EmptyState } from '@/components/common/Feedback';
import { Group, Section } from '@/components/common/List';
import { ConfirmDialog } from '@/components/common/Sheet';
import { PageHeader } from '@/components/layout/PageHeader';
import { SettingsLink } from '@/components/layout/SettingsLink';
import { TransferCard } from '@/components/transfers/TransferCard';
import { TransferRow } from '@/components/transfers/TransferRow';
import { clearTransfers } from '@/services/storage/transferRepository';
import { ACTIVE_STATUSES, useTransferStore } from '@/stores/transferStore';
import { toast } from '@/stores/uiStore';
import type { TransferRecord } from '@/types';

type Filter = 'all' | 'send' | 'receive';

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function ActivityScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmClear, setConfirmClear] = useState(false);
  const live = useTransferStore((s) => s.live);
  const history = useTransferStore((s) => s.history);
  const loaded = useTransferStore((s) => s.historyLoaded);

  const active = Object.values(live).filter(
    (t) =>
      ACTIVE_STATUSES.has(t.record.status) && (filter === 'all' || t.record.direction === filter),
  );
  // Interrupted/failed sends that can still be resumed or retried stay as live cards.
  const actionable = Object.values(live).filter(
    (t) =>
      (t.canResume || t.canRetry) &&
      t.record.status !== 'cancelled' &&
      (filter === 'all' || t.record.direction === filter),
  );

  const groups = useMemo(() => {
    const actionableIds = new Set(
      Object.values(live)
        .filter((t) => (t.canResume || t.canRetry) && t.record.status !== 'cancelled')
        .map((t) => t.record.id),
    );
    const out: { label: string; items: TransferRecord[] }[] = [];
    for (const r of history) {
      if (ACTIVE_STATUSES.has(r.status) || actionableIds.has(r.id)) continue;
      if (filter !== 'all' && r.direction !== filter) continue;
      const label = dayLabel(r.startedAt);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(r);
      else out.push({ label, items: [r] });
    }
    return out;
  }, [history, filter, live]);

  const clear = async () => {
    setConfirmClear(false);
    const keep = new Set(
      Object.values(live)
        .filter((t) => ACTIVE_STATUSES.has(t.record.status))
        .map((t) => t.record.id),
    );
    await clearTransfers();
    useTransferStore
      .getState()
      .setHistory(useTransferStore.getState().history.filter((r) => keep.has(r.id)));
    toast({ tone: 'success', title: 'History cleared' });
  };

  const empty = !active.length && !actionable.length && !groups.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        actions={
          <>
            {history.length > 0 && (
              <Button variant="plain" size="sm" onClick={() => setConfirmClear(true)}>
                Clear
              </Button>
            )}
            <SettingsLink />
          </>
        }
      />
      <SegmentedControl
        label="Filter activity"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'send', label: 'Sent' },
          { value: 'receive', label: 'Received' },
        ]}
      />

      {active.length > 0 && (
        <Section title="In progress">
          <div className="space-y-3">
            {active.map((t) => (
              <TransferCard key={t.record.id} transfer={t} />
            ))}
          </div>
        </Section>
      )}

      {actionable.length > 0 && (
        <Section
          title="Needs attention"
          footer="Resume continues from the last confirmed byte after you pair with the same device again."
        >
          <div className="space-y-3">
            {actionable.map((t) => (
              <TransferCard key={t.record.id} transfer={t} />
            ))}
          </div>
        </Section>
      )}

      {groups.map((g) => (
        <Section key={g.label} title={g.label}>
          <Group>
            {g.items.map((r) => (
              <TransferRow key={r.id} record={r} />
            ))}
          </Group>
        </Section>
      ))}

      {loaded && empty && (
        <div className="rounded-[var(--radius-card)] bg-surface">
          <EmptyState
            icon={<History />}
            title={
              filter === 'all'
                ? 'No activity yet'
                : filter === 'send'
                  ? 'Nothing sent yet'
                  : 'Nothing received yet'
            }
            message="FileShare records what was transferred, with whom and whether it succeeded — never the file contents."
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Clear transfer history?"
        message="This removes the list of past transfers on this device. Files you already saved aren’t affected."
        confirmLabel="Clear History"
        destructive
        onConfirm={clear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
