import { useCallback, useRef, useState, type DragEvent } from 'react';
import { FileUp, MessageSquareText, Paperclip, Plus, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, IconButton } from '@/components/common/Button';
import { SegmentedControl } from '@/components/common/Controls';
import { Banner } from '@/components/common/Feedback';
import { Section } from '@/components/common/List';
import { FileIcon } from '@/components/files/FileIcon';
import { PageHeader } from '@/components/layout/PageHeader';
import { SettingsLink } from '@/components/layout/SettingsLink';
import { LARGE_TRANSFER_WARNING_BYTES, MAX_FILES_PER_TRANSFER } from '@/constants';
import { transferManager } from '@/services/transfer/transferManager';
import { useConnectionStore } from '@/stores/connectionStore';
import { toast } from '@/stores/uiStore';
import { cx } from '@/utils/cx';
import { fileTypeLabel } from '@/utils/filename';
import { formatBytes, pluralize } from '@/utils/format';
import { TextComposer } from './TextComposer';
import { RecipientPicker } from './RecipientPicker';

type Mode = 'files' | 'text';

interface Picked {
  key: string;
  file: File;
}

let pickedSeq = 0;

export function SendScreen() {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('mode') === 'text' ? 'text' : 'files';
  const setMode = (m: Mode) => setParams(m === 'text' ? { mode: 'text' } : {}, { replace: true });
  const [recipient, setRecipient] = useState<string | null>(null);
  const recipientPeer = useConnectionStore((s) => (recipient ? s.peers[recipient] : undefined));

  return (
    <div className="space-y-6">
      <PageHeader title="Send" actions={<SettingsLink />} />
      <SegmentedControl
        label="What to send"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'files', label: 'Files', icon: <Paperclip /> },
          { value: 'text', label: 'Text', icon: <MessageSquareText /> },
        ]}
      />
      <RecipientPicker
        value={recipient}
        onChange={setRecipient}
        next={mode === 'text' ? '/send?mode=text' : '/send'}
      />
      {mode === 'files' ? (
        <FilesComposer recipient={recipient} recipientName={recipientPeer?.remote?.name} />
      ) : (
        <TextComposer recipient={recipient} recipientName={recipientPeer?.remote?.name} />
      )}
    </div>
  );
}

function FilesComposer({
  recipient,
  recipientName,
}: {
  recipient: string | null;
  recipientName?: string;
}) {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const total = picked.reduce((s, p) => s + p.file.size, 0);

  const add = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    setPicked((prev) => {
      const room = MAX_FILES_PER_TRANSFER - prev.length;
      if (list.length > room) {
        toast({
          tone: 'error',
          title: `Up to ${MAX_FILES_PER_TRANSFER} files per transfer`,
          message: 'Send the rest in another transfer.',
        });
      }
      return [
        ...prev,
        ...list.slice(0, Math.max(0, room)).map((file) => ({ key: `f${++pickedSeq}`, file })),
      ];
    });
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    // Only plain files: skip dropped folders (they arrive as File-like entries without contents).
    const items = Array.from(e.dataTransfer.items ?? []);
    const isDir = (i: number) => !!items[i]?.webkitGetAsEntry?.()?.isDirectory;
    const files = Array.from(e.dataTransfer.files).filter((_, i) => !isDir(i));
    if (files.length < e.dataTransfer.files.length) {
      toast({
        tone: 'neutral',
        title: 'Folders were skipped',
        message: 'Drop the files inside the folder instead.',
      });
    }
    if (files.length) add(files);
  };

  const send = () => {
    if (!recipient) return;
    try {
      const id = transferManager.sendFiles(
        recipient,
        picked.map((p) => p.file),
      );
      setPicked([]);
      navigate(`/activity/${id}`);
    } catch (e) {
      toast({ tone: 'error', title: 'Couldn’t start the transfer', message: (e as Error).message });
    }
  };

  const disabledReason = !recipient
    ? 'Connect a device to send files.'
    : !picked.length
      ? 'Choose at least one file.'
      : null;

  return (
    <>
      <Section
        title="Files"
        action={
          picked.length > 0 && (
            <Button variant="plain" size="sm" onClick={() => setPicked([])}>
              Clear All
            </Button>
          )
        }
      >
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = '';
          }}
        />
        {picked.length === 0 ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cx(
              'flex flex-col items-center rounded-[var(--radius-card)] border-2 border-dashed px-6 py-10 text-center transition-colors',
              dragging ? 'border-accent bg-accent-soft' : 'border-separator bg-surface',
            )}
          >
            <span
              className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent"
              aria-hidden
            >
              <FileUp className="size-7" />
            </span>
            <p className="mt-4 text-headline font-semibold text-text">Choose files to send</p>
            <p className="mt-1 max-w-xs text-callout text-text-2">
              Photos, videos, documents — any type. Files are sent as-is, without compression.
            </p>
            <Button className="mt-5" onClick={() => input.current?.click()}>
              Choose Files
            </Button>
            <p className="pointer-only mt-3 text-footnote text-text-2">or drag files here</p>
          </div>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cx(
              'overflow-hidden rounded-[var(--radius-card)] bg-surface',
              dragging && 'ring-2 ring-accent',
            )}
          >
            <ul className="divide-y divide-separator">
              {picked.map((p) => (
                <li key={p.key} className="flex min-h-11 items-center gap-3 py-2 pr-2 pl-4">
                  <FileIcon name={p.file.name} mime={p.file.type} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-text">{p.file.name}</p>
                    <p className="text-footnote text-text-2 tabular">
                      {formatBytes(p.file.size)} · {fileTypeLabel(p.file.name, p.file.type)}
                    </p>
                  </div>
                  <IconButton
                    label={`Remove ${p.file.name}`}
                    icon={<X className="size-5" />}
                    onClick={() => setPicked((prev) => prev.filter((x) => x.key !== p.key))}
                  />
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="hairline-t flex min-h-11 w-full items-center gap-3 px-4 text-body text-accent active:bg-surface-2"
            >
              <Plus className="size-5" aria-hidden /> Add More Files
            </button>
          </div>
        )}
      </Section>

      {total > LARGE_TRANSFER_WARNING_BYTES && (
        <Banner tone="warning" title="Large transfer">
          Keep FileShare open and your screen awake on both devices while transferring large files.
          Browsers pause pages that are in the background.
        </Banner>
      )}

      <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-10 -mx-4 bg-bg/90 px-4 pt-2 pb-3 backdrop-blur-md sm:-mx-6 sm:px-6 md:bottom-0 md:-mx-10 md:px-10 md:pb-6">
        {picked.length > 0 && (
          <p className="mb-2 text-center text-footnote text-text-2 tabular">
            {pluralize(picked.length, 'file')} · {formatBytes(total)}
          </p>
        )}
        <Button
          size="lg"
          block
          onClick={send}
          disabled={!!disabledReason}
          aria-describedby="send-hint"
        >
          {picked.length
            ? `Send ${pluralize(picked.length, 'File')}${recipientName ? ` to ${recipientName}` : ''}`
            : 'Send'}
        </Button>
        {disabledReason && (
          <p id="send-hint" className="mt-2 text-center text-footnote text-text-2">
            {disabledReason}
          </p>
        )}
      </div>
    </>
  );
}
