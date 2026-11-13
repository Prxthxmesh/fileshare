import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Pause, Play, Share2 } from 'lucide-react';
import { Button, IconButton } from '@/components/common/Button';
import { QR_PART_ROTATE_MS } from '@/constants';
import { useNow } from '@/hooks/useNow';
import { copyText } from '@/services/clipboard/clipboardService';
import { toast } from '@/stores/uiStore';
import { cx } from '@/utils/cx';
import { QrCode } from './QrCode';

function formatCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Shows one or more QR parts. Multipart codes advance automatically so the
 * other camera can collect every part; people can also pause and step
 * through manually. A text fallback is available for when scanning fails.
 */
export function QrDisplay({
  parts,
  expiresAt,
  label,
}: {
  parts: string[];
  expiresAt: number;
  label: string;
}) {
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(true);
  const [showText, setShowText] = useState(false);
  const now = useNow(1000);
  const remaining = expiresAt - now;
  const expired = remaining <= 0;
  const multi = parts.length > 1;
  const current = index % parts.length;

  useEffect(() => {
    if (!multi || !auto) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % parts.length), QR_PART_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [multi, auto, parts.length]);

  const allText = parts.join('\n');
  const copy = async () => {
    const res = await copyText(allText);
    toast(
      res.ok
        ? { tone: 'success', title: 'Code copied' }
        : { tone: 'error', title: 'Couldn’t copy', message: res.reason },
    );
  };
  const share = async () => {
    try {
      await navigator.share({ text: allText });
    } catch {
      // cancelled
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div
        className={cx(
          'relative w-full max-w-[min(22rem,38dvh)] rounded-[var(--radius-card)] bg-white p-3',
          expired && 'opacity-30',
        )}
      >
        <QrCode
          text={parts[current]}
          label={multi ? `${label}, part ${current + 1} of ${parts.length}` : label}
          className="block h-auto w-full"
        />
      </div>

      {multi && (
        <div className="mt-3 flex items-center gap-1" aria-live="polite">
          <IconButton
            label="Previous part"
            icon={<ChevronLeft className="size-5" />}
            onClick={() => {
              setAuto(false);
              setIndex((i) => (i - 1 + parts.length) % parts.length);
            }}
          />
          <div className="flex min-w-32 flex-col items-center">
            <span className="text-callout font-semibold text-text tabular">
              Part {current + 1} of {parts.length}
            </span>
            <span className="mt-1 flex gap-1" aria-hidden>
              {parts.map((_, i) => (
                <span
                  key={i}
                  className={cx(
                    'size-1.5 rounded-full',
                    i === current ? 'bg-accent' : 'bg-surface-3',
                  )}
                />
              ))}
            </span>
          </div>
          <IconButton
            label="Next part"
            icon={<ChevronRight className="size-5" />}
            onClick={() => {
              setAuto(false);
              setIndex((i) => (i + 1) % parts.length);
            }}
          />
          <IconButton
            label={auto ? 'Stop cycling parts' : 'Cycle parts automatically'}
            icon={auto ? <Pause className="size-4" /> : <Play className="size-4" />}
            onClick={() => setAuto((a) => !a)}
          />
        </div>
      )}

      <p
        className={cx(
          'mt-3 text-footnote tabular',
          expired ? 'font-semibold text-danger' : 'text-text-2',
        )}
        role={expired ? 'alert' : undefined}
      >
        {expired ? 'This code has expired.' : `Expires in ${formatCountdown(remaining)}`}
      </p>

      <div className="mt-4 w-full">
        <button
          type="button"
          aria-expanded={showText}
          onClick={() => setShowText((s) => !s)}
          className="mx-auto flex min-h-11 items-center px-3 text-callout font-medium text-accent"
        >
          {showText ? 'Hide text code' : 'Can’t scan? Use a text code'}
        </button>
        {showText && (
          <div className="mt-2 space-y-3 rounded-[var(--radius-card)] bg-surface p-4">
            <p className="text-footnote text-text-2">
              Send this text to the other device (for example with AirDrop, Nearby Share or a
              message to yourself), then paste it there under “Enter code manually”.
            </p>
            <textarea
              readOnly
              value={allText}
              aria-label="Pairing code as text"
              rows={4}
              onFocus={(e) => e.currentTarget.select()}
              className="block w-full resize-none rounded-[var(--radius-control)] bg-surface-2 p-3 font-mono text-caption break-all text-text"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy className="size-4" />}
                onClick={copy}
              >
                Copy
              </Button>
              {'share' in navigator && (
                <Button
                  size="sm"
                  variant="neutral"
                  icon={<Share2 className="size-4" />}
                  onClick={share}
                >
                  Share
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
