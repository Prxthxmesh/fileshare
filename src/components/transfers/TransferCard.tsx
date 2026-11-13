import { ArrowDownToLine, ArrowUpFromLine, Pause, Play, RotateCcw, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, IconButton } from '@/components/common/Button';
import { ProgressBar, StatusLabel } from '@/components/common/Feedback';
import { ConfirmDialog } from '@/components/common/Sheet';
import { useCancelTransfer } from '@/hooks/useCancelTransfer';
import { transferManager } from '@/services/transfer/transferManager';
import { selectReadyPeers, useConnectionStore } from '@/stores/connectionStore';
import type { LiveTransfer } from '@/stores/transferStore';
import { toast } from '@/stores/uiStore';
import { formatBytes, formatEta, formatSpeed, percent, pluralize } from '@/utils/format';
import { useShallow } from 'zustand/react/shallow';

/** Live transfer: name, overall progress, speed, ETA, file count, and controls. */
export function TransferCard({ transfer, compact }: { transfer: LiveTransfer; compact?: boolean }) {
  const { record, progress } = transfer;
  const cancel = useCancelTransfer();
  const navigate = useNavigate();
  const ready = useConnectionStore(useShallow(selectReadyPeers));
  const sending = record.direction === 'send';
  const running = ['active', 'paused', 'verifying'].includes(record.status);
  const waiting = record.status === 'awaiting-approval' || record.status === 'pending';
  const pct = percent(progress.bytes, record.totalBytes);
  const completedFiles = record.files.filter((f) => f.status === 'verified').length;
  const current = record.files[progress.currentFileIndex];
  const samePeer = ready.find((p) => p.remote?.deviceId === record.peerDeviceId);

  const title =
    record.files.length === 1 ? record.files[0].name : pluralize(record.files.length, 'file');
  const Direction = sending ? ArrowUpFromLine : ArrowDownToLine;

  const resume = () => {
    if (!samePeer) {
      toast({
        tone: 'neutral',
        title: `Pair with ${record.peerName} again to resume`,
        message: 'Open Send › Scan Device, then tap Resume here.',
      });
      return;
    }
    try {
      transferManager.resumeOutgoing(record.id, samePeer.id);
    } catch (e) {
      toast({ tone: 'error', title: 'Couldn’t resume', message: (e as Error).message });
    }
  };
  const retry = () => {
    if (!samePeer) {
      toast({ tone: 'neutral', title: `Pair with ${record.peerName} again to retry` });
      return;
    }
    try {
      const id = transferManager.retryOutgoing(record.id, samePeer.id);
      navigate(`/activity/${id}`);
    } catch (e) {
      toast({ tone: 'error', title: 'Couldn’t retry', message: (e as Error).message });
    }
  };

  return (
    <article
      className="rounded-[var(--radius-card)] bg-surface p-4"
      aria-label={`${sending ? 'Sending' : 'Receiving'} ${title}`}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent"
          aria-hidden
        >
          <Direction className="size-[1.15rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <Link
            to={`/activity/${record.id}`}
            className="block truncate text-body font-semibold text-text hover:underline"
          >
            {title}
          </Link>
          <p className="text-footnote text-text-2">
            {sending ? 'To' : 'From'} {record.peerName} · {formatBytes(record.totalBytes)}
          </p>
        </div>
        <div className="-mt-1.5 -mr-2 flex">
          {record.status === 'active' && (
            <IconButton
              label="Pause transfer"
              icon={<Pause className="size-5" />}
              onClick={() => transferManager.pause(record.id)}
            />
          )}
          {record.status === 'paused' && progress.pausedBy === 'local' && (
            <IconButton
              label="Resume transfer"
              tone="accent"
              icon={<Play className="size-5" />}
              onClick={() => transferManager.resume(record.id)}
            />
          )}
          {(running || waiting) && (
            <IconButton
              label="Cancel transfer"
              icon={<X className="size-5" />}
              onClick={() => cancel.request(record.id, running)}
            />
          )}
        </div>
      </div>

      {(running || waiting) && (
        <div className="mt-3 space-y-2">
          <ProgressBar
            value={pct}
            label={`${title} progress`}
            tone={record.status === 'paused' ? 'muted' : 'accent'}
          />
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-footnote text-text-2 tabular">
            {waiting ? (
              <span>Waiting for {record.peerName} to accept…</span>
            ) : record.status === 'paused' ? (
              <span>
                Paused{progress.pausedBy === 'remote' ? ` by ${record.peerName}` : ''} ·{' '}
                {formatBytes(progress.bytes)} of {formatBytes(record.totalBytes)}
              </span>
            ) : (
              <span>
                {formatBytes(progress.bytes)} of {formatBytes(record.totalBytes)} ·{' '}
                {formatSpeed(progress.speed)}
              </span>
            )}
            {record.status === 'active' && <span>{formatEta(progress.etaMs)}</span>}
          </div>
          {!compact && record.files.length > 1 && running && (
            <p className="truncate text-footnote text-text-3">
              {completedFiles} of {record.files.length} done
              {current ? ` · Now: ${current.name}` : ''}
            </p>
          )}
        </div>
      )}

      {!running && !waiting && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusLabel status={record.status} />
          {record.failureReason && (
            <p className="w-full text-footnote text-text-2">{record.failureReason}</p>
          )}
          {(transfer.canResume || transfer.canRetry) && (
            <div className="flex w-full gap-2">
              {transfer.canResume && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Play className="size-4" />}
                  onClick={resume}
                >
                  Resume
                </Button>
              )}
              {transfer.canRetry && (
                <Button
                  size="sm"
                  variant="neutral"
                  icon={<RotateCcw className="size-4" />}
                  onClick={retry}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={cancel.pending === record.id}
        title="Cancel this transfer?"
        message={`Progress so far will be lost${sending ? '' : ' and partially received files deleted'}.`}
        confirmLabel="Cancel Transfer"
        cancelLabel="Keep Going"
        destructive
        onConfirm={cancel.confirm}
        onCancel={cancel.dismiss}
      />
    </article>
  );
}
