import { useState } from 'react';
import { BadgeCheck, Unplug, WifiOff } from 'lucide-react';
import { IconButton } from '@/components/common/Button';
import { Group, Row } from '@/components/common/List';
import { ConfirmDialog } from '@/components/common/Sheet';
import { transferManager } from '@/services/transfer/transferManager';
import { peerManager } from '@/services/webrtc/peerManager';
import { selectReadyPeers, useConnectionStore } from '@/stores/connectionStore';
import { formatRelativeTime } from '@/utils/format';
import { useShallow } from 'zustand/react/shallow';
import { DeviceGlyph } from './DeviceIcon';

/** Live connections, with a disconnect action. Renders nothing when none. */
export function ConnectedDevices() {
  const peers = useConnectionStore(useShallow(selectReadyPeers));
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (!peers.length) return null;
  const disconnect = (id: string) => {
    if (transferManager.hasRunningTransfers(id)) setConfirmId(id);
    else peerManager.dismiss(id);
  };
  return (
    <>
      <Group>
        {peers.map((p) => (
          <Row
            key={p.id}
            leading={
              <span className="flex size-9 items-center justify-center rounded-[10px] bg-success-soft text-success">
                <DeviceGlyph kind={p.remote?.kind ?? 'unknown'} className="size-[1.15rem]" />
              </span>
            }
            title={p.remote?.name ?? 'Unknown device'}
            subtitle={
              p.phase === 'unstable' ? (
                <span className="inline-flex items-center gap-1 text-warning">
                  <WifiOff className="size-3.5" aria-hidden /> Connection unstable — waiting for the
                  device…
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <BadgeCheck className="size-3.5 text-success" aria-hidden />
                  Verified · Connected{' '}
                  {p.connectedAt ? formatRelativeTime(p.connectedAt).toLowerCase() : ''}
                </span>
              )
            }
            trailing={
              <IconButton
                label={`Disconnect ${p.remote?.name ?? 'device'}`}
                icon={<Unplug className="size-5" />}
                onClick={() => disconnect(p.id)}
              />
            }
          />
        ))}
      </Group>
      <ConfirmDialog
        open={!!confirmId}
        title="Disconnect while transferring?"
        message="Transfers in progress with this device will stop. You can resume sending after pairing again."
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => {
          if (confirmId) peerManager.dismiss(confirmId);
          setConfirmId(null);
        }}
        onCancel={() => setConfirmId(null)}
      />
    </>
  );
}
