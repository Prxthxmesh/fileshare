import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, ClipboardPaste, SwitchCamera } from 'lucide-react';
import { Button, IconButton } from '@/components/common/Button';
import { Banner, Spinner } from '@/components/common/Feedback';
import { canReadClipboard, readClipboard } from '@/services/clipboard/clipboardService';
import { CameraError, openCamera, startScanLoop, stopStream } from '@/services/pairing/qrDecoder';
import { cx } from '@/utils/cx';

/**
 * Camera viewfinder that reports decoded QR text, with a manual-entry
 * fallback. `paused` keeps the camera running but stops decoding — the
 * answering device keeps the camera on while it prepares its reply, which
 * lets the browser share real local addresses (see ice.ts).
 */
export function QrScanner({
  onScan,
  onManual,
  onStream,
  paused,
  progress,
  instruction,
}: {
  onScan: (text: string) => void;
  onManual: (text: string) => void;
  onStream?: (stream: MediaStream | null) => void;
  paused?: boolean;
  progress?: { received: number; total: number } | null;
  instruction: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState<CameraError | null>(null);
  const [starting, setStarting] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState('');
  const onScanRef = useRef(onScan);
  const onStreamRef = useRef(onStream);
  const pausedRef = useRef(paused);
  useLayoutEffect(() => {
    onScanRef.current = onScan;
    onStreamRef.current = onStream;
    pausedRef.current = paused;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopLoop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await openCamera(facing);
        if (cancelled) {
          stopStream(stream);
          return;
        }
        onStreamRef.current?.(stream);
        const v = video.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setStarting(false);
        stopLoop = await startScanLoop(v, (text) => {
          if (!pausedRef.current) onScanRef.current(text);
        });
      } catch (e) {
        if (!cancelled) {
          setStarting(false);
          setError(
            e instanceof CameraError
              ? e
              : new CameraError('The camera couldn’t be started.', 'unknown'),
          );
          setManualOpen(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      stopLoop?.();
      onStreamRef.current?.(null);
      stopStream(stream);
    };
  }, [facing]);

  const switchCamera = () => {
    setStarting(true);
    setError(null);
    setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
  };

  const paste = async () => {
    const res = await readClipboard();
    if (res.ok) setManual(res.text);
  };

  return (
    <div className="space-y-4">
      {!error && (
        <div className="relative mx-auto aspect-square w-full max-w-[22rem] overflow-hidden rounded-[var(--radius-card)] bg-black">
          <video
            ref={video}
            playsInline
            muted
            autoPlay
            className="size-full object-cover"
            aria-label="Camera viewfinder"
          />
          {/* Framing guide */}
          <div
            className="pointer-events-none absolute inset-[12%] rounded-[1.25rem] border-2 border-white/80"
            aria-hidden
          />
          {starting && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner className="text-white" label="Starting camera" />
            </div>
          )}
          {paused && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55">
              <Spinner className="size-7 text-white" label="Processing code" />
            </div>
          )}
          <IconButton
            label="Switch camera"
            icon={<SwitchCamera className="size-5" />}
            onClick={() => switchCamera()}
            className="absolute right-2 bottom-2 bg-black/50 text-white enabled:hover:bg-black/70"
          />
        </div>
      )}

      {error && (
        <Banner tone="warning" title="Camera unavailable">
          {error.message}
        </Banner>
      )}

      <p className="text-center text-callout text-text-2" aria-live="polite">
        {progress && progress.total > 1
          ? `Scanned ${progress.received} of ${progress.total} parts. Keep the camera on the code.`
          : instruction}
      </p>

      <div>
        {!manualOpen ? (
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="mx-auto flex min-h-11 items-center px-3 text-callout font-medium text-accent"
          >
            Enter code manually
          </button>
        ) : (
          <form
            className="space-y-3 rounded-[var(--radius-card)] bg-surface p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.trim()) onManual(manual);
            }}
          >
            <label htmlFor="manual-code" className="block text-callout font-semibold text-text">
              Pairing code
            </label>
            <textarea
              id="manual-code"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              rows={4}
              placeholder="Paste the code that starts with FS1"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="block w-full resize-none rounded-[var(--radius-control)] bg-surface-2 p-3 font-mono text-caption break-all text-text outline-none focus:ring-2 focus:ring-accent"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={!manual.trim() || paused} loading={paused}>
                Continue
              </Button>
              {canReadClipboard() && (
                <Button
                  size="sm"
                  variant="neutral"
                  icon={<ClipboardPaste className="size-4" />}
                  onClick={paste}
                >
                  Paste
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
      {error && error.code !== 'insecure' && error.code !== 'unsupported' && (
        <div className={cx('flex justify-center')}>
          <Button
            variant="plain"
            size="sm"
            icon={<Camera className="size-4" />}
            onClick={() => switchCamera()}
          >
            Try Camera Again
          </Button>
        </div>
      )}
    </div>
  );
}
