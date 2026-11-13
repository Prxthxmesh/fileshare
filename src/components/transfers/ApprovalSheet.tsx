import { Button } from '@/components/common/Button';
import { Banner } from '@/components/common/Feedback';
import { Sheet } from '@/components/common/Sheet';
import { FileIcon } from '@/components/files/FileIcon';
import { transferManager } from '@/services/transfer/transferManager';
import { useUiStore } from '@/stores/uiStore';
import { fileTypeLabel } from '@/utils/filename';
import { formatBytes, pluralize } from '@/utils/format';

/**
 * Every incoming transfer needs explicit approval. Shows who is sending, every
 * file (sanitized name, type, size), the total, and any storage limitation
 * before a single byte is accepted.
 */
export function ApprovalSheet() {
  const request = useUiStore((s) => s.approvals[0]);
  if (!request) return null;
  const { files } = request;
  const renamed = files.filter((f) => f.name !== f.originalName).length;

  return (
    <Sheet
      open
      dismissible={false}
      onClose={() => {}}
      size="lg"
      title={
        request.resume
          ? `Resume transfer from ${request.peerName}?`
          : `${request.peerName} wants to send you ${pluralize(files.length, 'file')}`
      }
      description={
        request.resume
          ? `${formatBytes(request.resumeBytes)} of ${formatBytes(request.totalSize)} already received. The rest will continue from there.`
          : `${formatBytes(request.totalSize)} in total`
      }
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="neutral"
            size="lg"
            onClick={() => transferManager.decline(request.transferId)}
            className="sm:min-w-32"
          >
            Decline
          </Button>
          <Button
            size="lg"
            onClick={() => transferManager.approve(request.transferId)}
            disabled={!!request.blocked}
            data-autofocus
            className="sm:min-w-32"
          >
            {request.resume ? 'Resume' : 'Accept'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pt-1">
        {request.blocked && (
          <Banner tone="error" title="Can’t receive these files">
            {request.blocked}
          </Banner>
        )}
        {request.warning && <Banner tone="warning">{request.warning}</Banner>}
        <ul className="divide-y divide-separator overflow-hidden rounded-[var(--radius-card)] bg-surface">
          {files.map((f) => (
            <li key={f.id} className="flex min-h-11 items-center gap-3 px-4 py-2">
              <FileIcon name={f.name} mime={f.mime} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body text-text">{f.name}</p>
                <p className="text-footnote text-text-2 tabular">
                  {formatBytes(f.size)} · {fileTypeLabel(f.name, f.mime)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {renamed > 0 && (
          <p className="text-footnote text-text-2">
            {pluralize(renamed, 'file name was', 'file names were')} adjusted to be safe or to avoid
            duplicates.
          </p>
        )}
        <p className="text-footnote text-text-2">
          Files are checked for integrity, then kept in FileShare until you save them. Nothing is
          opened automatically.
        </p>
      </div>
    </Sheet>
  );
}
