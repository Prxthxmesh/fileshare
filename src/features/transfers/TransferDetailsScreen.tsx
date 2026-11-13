import { useEffect, useState } from 'react';
import { BadgeCheck, CircleSlash, Clock, Loader2, ShieldAlert, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Banner, EmptyState, ProgressBar, StatusLabel } from '@/components/common/Feedback';
import { Group, Row, Section } from '@/components/common/List';
import { FileIcon } from '@/components/files/FileIcon';
import { PageHeader } from '@/components/layout/PageHeader';
import { TransferCard } from '@/components/transfers/TransferCard';
import { transferTitle } from '@/utils/transferTitle';
import { deleteTransfer } from '@/services/storage/transferRepository';
import { peerManager } from '@/services/webrtc/peerManager';
import type { PeerDiagnostics } from '@/services/webrtc/peerConnection';
import { ACTIVE_STATUSES, useTransferStore } from '@/stores/transferStore';
import type { TransferFileRecord } from '@/types';
import { formatBytes, formatDateTime, formatDuration, formatSpeed, percent } from '@/utils/format';
import { fileTypeLabel } from '@/utils/filename';

export function TransferDetailsScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const live = useTransferStore((s) => s.live[id]);
  const stored = useTransferStore((s) => s.history.find((r) => r.id === id));
  const record = live?.record ?? stored;
  const [diag, setDiag] = useState<PeerDiagnostics | null>(null);
  const peerId = live?.peerId;
  const running = record ? ACTIVE_STATUSES.has(record.status) : false;

  useEffect(() => {
    if (!peerId || !running) return;
    let alive = true;
    const tick = async () => {
      const session = peerManager.get(peerId);
      if (session && alive) setDiag(await session.diagnostics());
    };
    void tick();
    const t = window.setInterval(tick, 3000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [peerId, running]);

  if (!record) {
    return (
      <div className="space-y-6">
        <PageHeader title="Transfer" back={{ to: '/activity', label: 'Activity' }} />
        <EmptyState
          icon={<Clock />}
          title="Transfer not found"
          message="It may have been removed from history."
        />
      </div>
    );
  }

  const sending = record.direction === 'send';
  const avgSpeed =
    record.durationMs && record.durationMs > 500
      ? (record.files.reduce((s, f) => s + f.bytes, 0) * 1000) / record.durationMs
      : null;
  const remove = async () => {
    await deleteTransfer(record.id);
    useTransferStore.getState().removeHistory([record.id]);
    navigate('/activity', { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={transferTitle(record)}
        back={{ to: '/activity', label: 'Activity' }}
        subtitle={`${sending ? 'Sent to' : 'Received from'} ${record.peerName}`}
      />

      {live && (running || live.canResume || live.canRetry) && <TransferCard transfer={live} />}

      {!running && record.failureReason && (
        <Banner
          tone={record.status === 'failed' ? 'error' : 'info'}
          title={record.status === 'failed' ? 'What happened' : undefined}
        >
          {record.failureReason}
        </Banner>
      )}

      <Section title="Summary">
        <Group>
          <Row title="Status" trailing={<StatusLabel status={record.status} />} chevron={false} />
          <Row title="Device" trailing={record.peerName} chevron={false} />
          <Row title="Started" trailing={formatDateTime(record.startedAt)} chevron={false} />
          {record.kind === 'files' && (
            <>
              <Row
                title="Size"
                trailing={<span className="tabular">{formatBytes(record.totalBytes)}</span>}
                chevron={false}
              />
              <Row
                title="Transfer time"
                trailing={formatDuration(record.durationMs)}
                chevron={false}
              />
              <Row
                title="Average speed"
                trailing={<span className="tabular">{formatSpeed(avgSpeed)}</span>}
                chevron={false}
              />
              {!sending && record.storage && (
                <Row
                  title="Stored in"
                  trailing={record.storage === 'opfs' ? 'Private storage (disk)' : 'Memory'}
                  chevron={false}
                />
              )}
            </>
          )}
          {record.kind === 'text' && (
            <Row title="Length" trailing={`${record.textLength ?? 0} characters`} chevron={false} />
          )}
        </Group>
      </Section>

      {record.kind === 'files' && (
        <Section
          title="Files"
          footer="Each file is checked with SHA-256 over its complete contents after it arrives."
        >
          <Group>
            {record.files.map((f) => (
              <FileDetailRow
                key={f.fileId}
                file={f}
                liveBytes={live?.progress.fileBytes[f.fileId]}
              />
            ))}
          </Group>
        </Section>
      )}

      {diag && running && (
        <Section title="Connection">
          <Group>
            <Row
              title="Route"
              trailing={
                diag.selectedPair
                  ? `${diag.selectedPair.localType === 'relay' || diag.selectedPair.remoteType === 'relay' ? 'Relayed' : 'Direct'} · ${diag.selectedPair.protocol?.toUpperCase() ?? ''}`
                  : 'Checking…'
              }
              chevron={false}
            />
            <Row
              title="Round-trip time"
              trailing={diag.selectedPair?.rttMs != null ? `${diag.selectedPair.rttMs} ms` : '—'}
              chevron={false}
            />
            <Row title="Encryption" trailing="DTLS (WebRTC)" chevron={false} />
            <Row
              title="Internet servers"
              trailing={diag.usesStun ? 'STUN (address discovery only)' : 'None'}
              chevron={false}
            />
          </Group>
        </Section>
      )}

      {!running && (
        <Button variant="destructive-plain" icon={<Trash2 className="size-4" />} onClick={remove}>
          Remove from History
        </Button>
      )}
    </div>
  );
}

function FileDetailRow({ file: f, liveBytes }: { file: TransferFileRecord; liveBytes?: number }) {
  const bytes = liveBytes ?? f.bytes;
  const status =
    f.status === 'verified' ? (
      <span className="inline-flex items-center gap-1 text-success">
        <BadgeCheck className="size-3.5" aria-hidden /> Verified
      </span>
    ) : f.status === 'failed' ? (
      <span className="inline-flex items-center gap-1 text-danger">
        <ShieldAlert className="size-3.5" aria-hidden /> {f.failureReason ?? 'Failed'}
      </span>
    ) : f.status === 'cancelled' ? (
      <span className="inline-flex items-center gap-1">
        <CircleSlash className="size-3.5" aria-hidden /> Cancelled
      </span>
    ) : f.status === 'transferring' || f.status === 'verifying' ? (
      <span className="inline-flex items-center gap-1 text-accent">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />{' '}
        {f.status === 'verifying' ? 'Verifying' : 'Transferring'}
      </span>
    ) : (
      <span>Not sent</span>
    );
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <FileIcon name={f.name} mime={f.mime} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body text-text">{f.name}</p>
          <p className="flex flex-wrap gap-x-1.5 text-footnote text-text-2">
            <span className="tabular">{formatBytes(f.size)}</span>
            <span aria-hidden>·</span>
            <span>{fileTypeLabel(f.name, f.mime)}</span>
            <span aria-hidden>·</span>
            {status}
          </p>
        </div>
      </div>
      {(f.status === 'transferring' || f.status === 'verifying') && (
        <ProgressBar value={percent(bytes, f.size)} label={`${f.name} progress`} />
      )}
      {f.sha256 && (
        <p className="font-mono text-caption break-all text-text-3">SHA-256 {f.sha256}</p>
      )}
    </li>
  );
}
