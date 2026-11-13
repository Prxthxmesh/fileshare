import { useState } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { TextArea } from '@/components/common/Controls';
import { Section } from '@/components/common/List';
import { MAX_TEXT_LENGTH } from '@/constants';
import { canReadClipboard, readClipboard } from '@/services/clipboard/clipboardService';
import { transferManager } from '@/services/transfer/transferManager';
import { toast } from '@/stores/uiStore';
import { cx } from '@/utils/cx';

export function TextComposer({
  recipient,
  recipientName,
}: {
  recipient: string | null;
  recipientName?: string;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const over = text.length > MAX_TEXT_LENGTH;

  const paste = async () => {
    const res = await readClipboard();
    if (res.ok) setText((t) => (t ? `${t}\n${res.text}` : res.text));
    else toast({ tone: 'neutral', title: 'Paste manually', message: res.reason });
  };

  const send = async () => {
    if (!recipient) return;
    setSending(true);
    try {
      const result = await transferManager.sendText(recipient, text);
      if (result === 'delivered') {
        toast({ tone: 'success', title: `Text sent to ${recipientName ?? 'device'}` });
        setText('');
      } else {
        toast({
          tone: 'error',
          title: 'No confirmation from the other device',
          message: 'The text may not have arrived. Check the other device, then try again.',
        });
      }
    } catch (e) {
      toast({ tone: 'error', title: 'Couldn’t send the text', message: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Section
        title="Text"
        action={
          canReadClipboard() && (
            <Button
              variant="plain"
              size="sm"
              icon={<ClipboardPaste className="size-4" />}
              onClick={paste}
            >
              Paste
            </Button>
          )
        }
      >
        <TextArea
          label="Text to send"
          hideLabel
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Type or paste a link, note, address, or code snippet"
          autoCapitalize="sentences"
          spellCheck
        />
        <p
          className={cx(
            'px-1 text-right text-footnote tabular',
            over ? 'text-danger' : 'text-text-3',
          )}
        >
          {text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}
        </p>
      </Section>
      <Button
        size="lg"
        block
        onClick={send}
        loading={sending}
        disabled={!recipient || !text.trim() || over}
      >
        {recipientName ? `Send Text to ${recipientName}` : 'Send Text'}
      </Button>
      {!recipient && (
        <p className="text-center text-footnote text-text-2">Connect a device to send text.</p>
      )}
    </>
  );
}
