import { useState } from 'react';
import { BadgeCheck, Download, Share, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, IconButton } from '@/components/common/Button';
import { Group, Section } from '@/components/common/List';
import { FileIcon } from '@/components/files/FileIcon';
import { canShareFile, downloadFile, shareFile } from '@/services/transfer/saveFile';
import { removeOpfsFile, storageNameFor } from '@/services/transfer/receiveStorage';
import { useTransferStore, type ReceivedFile } from '@/stores/transferStore';
import { toast } from '@/stores/uiStore';
import { formatBytes, formatRelativeTime } from '@/utils/format';

/**
 * Verified received files waiting to be saved. Files stay inside the
 * browser's private storage until the person taps Save or Share; nothing is
 * opened or saved automatically.
 */
export function ReceivedFiles({ limit }: { limit?: number }) {
  const received = useTransferStore((s) => s.received);
  if (!received.length) return null;
  const shown = limit ? received.slice(0, limit) : received;
  const unsaved = received.filter((r) => !r.saved);

  const saveAll = async () => {
    for (const r of unsaved) await save(r);
  };

  return (
    <Section
      title="Received files"
      action={
        limit && received.length > limit ? (
          <Link
            to="/receive"
            className="inline-flex min-h-11 items-center px-1 text-callout font-medium text-accent"
          >
            See All ({received.length})
          </Link>
        ) : (
          unsaved.length > 1 && (
            <Button variant="plain" size="sm" onClick={saveAll}>
              Save All
            </Button>
          )
        )
      }
      footer={
        !limit
          ? 'Received files are kept in FileShare’s private browser storage until you save or remove them.'
          : undefined
      }
    >
      <Group>
        {shown.map((r) => (
          <ReceivedRow key={r.key} file={r} />
        ))}
      </Group>
    </Section>
  );
}

async function save(r: ReceivedFile) {
  try {
    const file = await r.getFile();
    await downloadFile(file, r.name);
    useTransferStore.getState().markSaved(r.key);
  } catch {
    toast({
      tone: 'error',
      title: `Couldn’t save “${r.name}”`,
      message: 'The browser may have cleared FileShare’s storage. Ask the sender to send it again.',
    });
  }
}

function ReceivedRow({ file: r }: { file: ReceivedFile }) {
  const [busy, setBusy] = useState(false);
  const share = async () => {
    setBusy(true);
    try {
      const file = await r.getFile();
      if (!canShareFile(file)) {
        await downloadFile(file, r.name);
      } else if ((await shareFile(file)) === 'shared') {
        useTransferStore.getState().markSaved(r.key);
      }
    } catch (e) {
      toast({ tone: 'error', title: 'Couldn’t share the file', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    useTransferStore.getState().removeReceived(r.key);
    if (r.storage === 'opfs') await removeOpfsFile(storageNameFor(r.transferId, r.fileId));
  };
  return (
    <li className="flex min-h-11 items-center gap-3 px-4 py-2">
      <FileIcon name={r.name} mime={r.mime} />
      <div className="min-w-0 flex-1 py-1">
        <p className="line-clamp-2 text-body break-words text-text">{r.name}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-footnote text-text-2">
          <span className="tabular">{formatBytes(r.size)}</span>
          <span aria-hidden>·</span>
          <span>{r.from}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-0.5 text-success">
            <BadgeCheck className="size-3.5" aria-hidden /> Verified
          </span>
          <span aria-hidden>·</span>
          <span>{r.saved ? 'Saved' : formatRelativeTime(r.receivedAt)}</span>
        </p>
      </div>
      <div className="-mr-2 flex">
        <IconButton
          label={`Save ${r.name}`}
          tone="accent"
          icon={<Download className="size-5" />}
          onClick={() => save(r)}
        />
        {'share' in navigator && (
          <IconButton
            label={`Share ${r.name}`}
            tone="accent"
            icon={<Share className="size-5" />}
            onClick={share}
            disabled={busy}
          />
        )}
        <IconButton
          label={`Remove ${r.name}`}
          icon={<Trash2 className="size-5" />}
          onClick={remove}
        />
      </div>
    </li>
  );
}
