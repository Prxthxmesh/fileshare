import { useState } from 'react';
import { BadgeCheck, MonitorSmartphone, ShieldOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { TextField } from '@/components/common/Controls';
import { EmptyState } from '@/components/common/Feedback';
import { Group, Row, Section } from '@/components/common/List';
import { ConfirmDialog, Sheet } from '@/components/common/Sheet';
import { ConnectedDevices } from '@/components/devices/ConnectedDevices';
import { DeviceGlyph } from '@/components/devices/DeviceIcon';
import { PageHeader } from '@/components/layout/PageHeader';
import { SettingsLink } from '@/components/layout/SettingsLink';
import { shortFingerprint } from '@/services/pairing/pairingSecurity';
import { displayName } from '@/services/storage/deviceRepository';
import { clearTransfers } from '@/services/storage/transferRepository';
import { useDeviceStore } from '@/stores/deviceStore';
import { useTransferStore } from '@/stores/transferStore';
import { toast } from '@/stores/uiStore';
import type { DeviceRecord } from '@/types';
import { formatDateTime, formatRelativeTime, pluralize } from '@/utils/format';

export function DevicesScreen() {
  const devices = useDeviceStore((s) => s.devices);
  const loaded = useDeviceStore((s) => s.loaded);
  const [selected, setSelected] = useState<string | null>(null);
  const device = devices.find((d) => d.deviceId === selected) ?? null;

  return (
    <div className="space-y-8">
      <PageHeader title="Devices" actions={<SettingsLink />} />

      <Section title="Connected now">
        <ConnectedDevices />
        <div className="flex gap-2">
          <Link
            to="/pair/show"
            className="flex min-h-11 flex-1 items-center justify-center rounded-[var(--radius-control)] bg-accent-soft px-4 text-callout font-semibold text-accent"
          >
            Pair New Device
          </Link>
          <Link
            to="/pair/scan"
            className="flex min-h-11 flex-1 items-center justify-center rounded-[var(--radius-control)] bg-surface-2 px-4 text-callout font-semibold text-text"
          >
            Scan Device
          </Link>
        </div>
      </Section>

      <Section
        title="Known devices"
        footer="Every connection starts with a QR pairing — browsers can’t discover devices on their own. A verified device is recognised automatically next time if it presents the same security identity."
      >
        {devices.length ? (
          <Group>
            {devices.map((d) => (
              <Row
                key={d.deviceId}
                onClick={() => setSelected(d.deviceId)}
                leading={
                  <span
                    className="flex size-9 items-center justify-center rounded-[10px] bg-surface-2 text-text-2"
                    aria-hidden
                  >
                    <DeviceGlyph kind={d.kind} className="size-[1.15rem]" />
                  </span>
                }
                title={displayName(d)}
                subtitle={
                  <span className="inline-flex flex-wrap items-center gap-x-1.5">
                    {d.trusted ? (
                      <span className="inline-flex items-center gap-0.5 text-success">
                        <BadgeCheck className="size-3.5" aria-hidden /> Verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5">
                        <ShieldOff className="size-3.5" aria-hidden /> Not trusted
                      </span>
                    )}
                    <span aria-hidden>·</span>
                    <span>{formatRelativeTime(d.lastConnected)}</span>
                    <span aria-hidden>·</span>
                    <span>{pluralize(d.transferCount, 'transfer')}</span>
                  </span>
                }
              />
            ))}
          </Group>
        ) : (
          loaded && (
            <div className="rounded-[var(--radius-card)] bg-surface">
              <EmptyState
                icon={<MonitorSmartphone />}
                title="No devices yet"
                message="Devices you pair with appear here, so you can rename them or revoke trust."
              />
            </div>
          )
        )}
      </Section>

      <DeviceSheet device={device} onClose={() => setSelected(null)} />
    </div>
  );
}

function DeviceSheet({ device, onClose }: { device: DeviceRecord | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<'remove' | 'history' | 'revoke' | null>(null);
  const { rename, revokeTrust, remove } = useDeviceStore.getState();
  const [lastId, setLastId] = useState<string | null>(null);
  if (device && device.deviceId !== lastId) {
    setLastId(device.deviceId);
    setName(displayName(device));
  }
  if (!device) return null;

  const saveName = async () => {
    if (name.trim() && name.trim() !== displayName(device)) {
      await rename(device.deviceId, name);
      toast({ tone: 'success', title: 'Device renamed' });
    }
  };
  const act = async () => {
    const kind = confirm;
    setConfirm(null);
    if (kind === 'revoke') {
      await revokeTrust(device.deviceId);
      toast({
        tone: 'success',
        title: 'Trust revoked',
        message: 'You’ll compare verification codes again next time.',
      });
    } else if (kind === 'history') {
      await clearTransfers(device.deviceId);
      const store = useTransferStore.getState();
      store.removeHistory(
        store.history.filter((r) => r.peerDeviceId === device.deviceId).map((r) => r.id),
      );
      toast({ tone: 'success', title: 'Device history cleared' });
    } else if (kind === 'remove') {
      await remove(device.deviceId);
      onClose();
      toast({ tone: 'success', title: 'Device removed' });
    }
  };

  return (
    <>
      <Sheet
        open={!!device && !confirm}
        onClose={onClose}
        title={displayName(device)}
        description={`${device.platform} · ${device.kind === 'unknown' ? 'Device' : device.kind[0].toUpperCase() + device.kind.slice(1)}`}
      >
        <div className="space-y-6 pt-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
            className="flex items-end gap-2"
          >
            <TextField
              label="Name on this device"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              className="flex-1"
            />
            <Button type="submit" variant="secondary">
              Save
            </Button>
          </form>

          <Group>
            <Row
              title="Status"
              trailing={device.trusted ? 'Verified' : 'Not trusted'}
              chevron={false}
            />
            <Row
              title="Identity"
              trailing={
                <span className="font-mono text-footnote">
                  {shortFingerprint(device.fingerprint)}
                </span>
              }
              chevron={false}
            />
            <Row title="First paired" trailing={formatDateTime(device.firstSeen)} chevron={false} />
            <Row
              title="Last connected"
              trailing={formatDateTime(device.lastConnected)}
              chevron={false}
            />
            <Row title="Transfers" trailing={String(device.transferCount)} chevron={false} />
          </Group>

          <div className="space-y-1">
            {device.trusted && (
              <Button variant="plain" block onClick={() => setConfirm('revoke')}>
                Revoke Trust
              </Button>
            )}
            <Button variant="plain" block onClick={() => setConfirm('history')}>
              Clear Device History
            </Button>
            <Button variant="destructive-plain" block onClick={() => setConfirm('remove')}>
              Remove Device
            </Button>
          </div>
        </div>
      </Sheet>
      <ConfirmDialog
        open={!!confirm}
        title={
          confirm === 'revoke'
            ? 'Revoke trust?'
            : confirm === 'history'
              ? 'Clear this device’s history?'
              : 'Remove this device?'
        }
        message={
          confirm === 'revoke'
            ? 'Next time it connects, you’ll need to compare verification codes again.'
            : confirm === 'history'
              ? 'Transfers with this device will be removed from Activity.'
              : 'Its name, trust and statistics will be deleted from this device. Transfer history stays.'
        }
        confirmLabel={
          confirm === 'revoke' ? 'Revoke' : confirm === 'history' ? 'Clear History' : 'Remove'
        }
        destructive
        onConfirm={act}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
