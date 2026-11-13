import { Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Sheet } from '@/components/common/Sheet';
import { classifyText, copyText, safeHttpUrl } from '@/services/clipboard/clipboardService';
import { toast, useUiStore } from '@/stores/uiStore';
import { cx } from '@/utils/cx';

export function IncomingTextSheet() {
  const text = useUiStore((s) => s.texts[0]);
  const approvalOpen = useUiStore((s) => s.approvals.length > 0);
  const remove = useUiStore((s) => s.removeText);
  if (!text || approvalOpen) return null;
  const kind = classifyText(text.content);
  const url = kind === 'url' ? safeHttpUrl(text.content) : null;

  const copy = async () => {
    const res = await copyText(text.content);
    if (res.ok) {
      toast({ tone: 'success', title: 'Copied to clipboard' });
      remove(text.id);
    } else {
      toast({ tone: 'error', title: 'Couldn’t copy', message: res.reason });
    }
  };

  return (
    <Sheet
      open
      onClose={() => remove(text.id)}
      title={`Text from ${text.peerName}`}
      description={`${text.content.length.toLocaleString()} characters`}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="neutral" onClick={() => remove(text.id)}>
            Done
          </Button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-accent-soft px-4 text-callout font-semibold text-accent"
            >
              <ExternalLink className="size-4" aria-hidden /> Open Link
            </a>
          )}
          <Button icon={<Copy className="size-4" />} onClick={copy} data-autofocus>
            Copy
          </Button>
        </div>
      }
    >
      <pre
        tabIndex={0}
        className={cx(
          'max-h-[50dvh] overflow-auto rounded-[var(--radius-card)] bg-surface p-4 text-body break-words whitespace-pre-wrap text-text select-text',
          kind === 'code' && 'font-mono text-callout',
          kind !== 'code' && 'font-sans',
        )}
      >
        {text.content}
      </pre>
      <p className="mt-2 text-footnote text-text-2">Select the text to copy part of it.</p>
    </Sheet>
  );
}
