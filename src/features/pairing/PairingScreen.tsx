import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, RefreshCw, X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, IconButton } from '@/components/common/Button';
import { Banner, Spinner } from '@/components/common/Feedback';
import { QrDisplay } from '@/components/pairing/QrDisplay';
import { QrScanner } from '@/components/pairing/QrScanner';
import { VerificationPanel } from '@/components/pairing/VerificationPanel';
import { hexToRendezvous, randomSecretHex } from '@/services/link/linkCrypto';
import { linkService } from '@/services/link/linkService';
import { PartCollector, PairingCodeError } from '@/services/pairing/pairingSession';
import { peerManager } from '@/services/webrtc/peerManager';
import { isReadyPhase, useConnectionStore } from '@/stores/connectionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useNow } from '@/hooks/useNow';
import { cx } from '@/utils/cx';

type Mode = 'show' | 'scan';

/**
 * Two flows over the same three steps:
 *   show (receiving device):  1 Show code → 2 Scan reply → 3 Confirm
 *   scan (sending device):    1 Scan code → 2 Show reply → 3 Confirm
 */
export function PairingScreen({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? (mode === 'scan' ? '/send' : '/receive');

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [parts, setParts] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanningReply, setScanningReply] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  /** Scan flow: the reply went out through quick connect, so no second scan should be needed. */
  const [reply, setReply] = useState<'none' | 'sending' | 'sent' | 'failed'>('none');
  const quickConnect = useSettingsStore((s) => s.settings.quickConnect);
  const peer = useConnectionStore((s) => (sessionId ? s.peers[sessionId] : undefined));
  const collector = useRef(new PartCollector());
  const camera = useRef<MediaStream | null>(null);
  const lastFailedText = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  // Offerer: create the code when the screen opens (and on "Create New Code").
  useEffect(() => {
    if (mode !== 'show') return;
    let cancelled = false;
    let stopListening: (() => void) | null = null;
    // A one-time rendezvous secret in the QR lets the scanning device send its
    // reply back through the encrypted relay — no second scan needed.
    const rv = quickConnect ? hexToRendezvous(randomSecretHex(16)) : undefined;
    peerManager
      .startOffer(rv)
      .then(async ({ session, parts: p }) => {
        if (cancelled) {
          peerManager.dismiss(session.id);
          return;
        }
        sessionRef.current = session.id;
        setSessionId(session.id);
        setParts(p);
        if (rv) {
          stopListening = await linkService.listenForPairingReply(rv, (sid, data) => {
            const view = useConnectionStore.getState().peers[session.id];
            if (sid !== session.sid || view?.phase !== 'awaiting-answer') return;
            peerManager.applyAnswer(session.id, data).catch((e) => setError(messageOf(e)));
          });
          if (cancelled) stopListening();
        }
      })
      .catch((e) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
      stopListening?.();
    };
  }, [mode, attempt, quickConnect]);

  // Leaving the screen before the connection is verified abandons the attempt.
  useEffect(
    () => () => {
      const id = sessionRef.current;
      const view = id ? useConnectionStore.getState().peers[id] : undefined;
      if (id && view && !isReadyPhase(view.phase)) peerManager.dismiss(id);
    },
    [],
  );

  const handleCode = useCallback(
    async (text: string, manual = false) => {
      if (busy) return;
      if (!manual && text === lastFailedText.current) return;
      let result;
      try {
        result = manual ? collector.current.addMany(text) : collector.current.add(text);
      } catch (e) {
        lastFailedText.current = text;
        setError(messageOf(e));
        return;
      }
      if (result.status === 'ignored') return;
      if (result.status === 'partial') {
        setProgress({ received: result.received, total: result.total });
        setError(null);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        if (mode === 'scan') {
          const {
            session,
            parts: reply,
            data,
            offer,
          } = await peerManager.answerOffer(result.data, camera.current);
          sessionRef.current = session.id;
          setSessionId(session.id);
          setParts(reply);
          if (offer.rv) {
            setReply('sending');
            void linkService
              .sendPairingReply(offer.rv, offer.sid, data)
              .then((ok) => setReply(ok ? 'sent' : 'failed'));
          }
        } else if (sessionId) {
          await peerManager.applyAnswer(sessionId, result.data);
          setScanningReply(false);
        }
        lastFailedText.current = null;
      } catch (e) {
        lastFailedText.current = text;
        setError(messageOf(e));
      } finally {
        collector.current.reset();
        setProgress(null);
        setBusy(false);
      }
    },
    [busy, mode, sessionId],
  );

  const restart = () => {
    if (sessionId) peerManager.dismiss(sessionId);
    sessionRef.current = null;
    setSessionId(null);
    setParts(null);
    setError(null);
    setScanningReply(false);
    setReply('none');
    collector.current.reset();
    lastFailedText.current = null;
    setAttempt((a) => a + 1);
  };

  const close = () => navigate(-1);

  // ---- Derive the step ------------------------------------------------------
  const phase = peer?.phase;
  let step: 1 | 2 | 3 = 1;
  if (mode === 'show') step = phase && phase !== 'awaiting-answer' ? 3 : scanningReply ? 2 : 1;
  else step = !parts ? 1 : phase === 'verifying' || (phase && isReadyPhase(phase)) ? 3 : 2;
  const failed = phase === 'failed' || phase === 'closed';
  const steps =
    mode === 'show'
      ? ['Show code', quickConnect ? 'Connect' : 'Scan reply', 'Confirm']
      : ['Scan code', quickConnect ? 'Connect' : 'Show reply', 'Confirm'];

  return (
    <div className="safe-top mx-auto flex min-h-dvh max-w-xl flex-col pb-8">
      <header className="flex min-h-14 items-center justify-between pt-2">
        <IconButton
          label="Close pairing"
          icon={<X className="size-6" />}
          onClick={close}
          className="-ml-2"
        />
        <h1 className="text-headline font-semibold text-text">
          {mode === 'show' ? 'Pair New Device' : 'Scan Device'}
        </h1>
        <span className="size-11" />
      </header>

      <ol className="mt-2 mb-6 grid grid-cols-3 gap-2" aria-label="Pairing steps">
        {steps.map((label, i) => {
          const n = i + 1;
          const state = failed ? 'idle' : n < step ? 'done' : n === step ? 'current' : 'idle';
          return (
            <li
              key={label}
              aria-current={state === 'current' ? 'step' : undefined}
              className="flex flex-col gap-1.5"
            >
              <span
                className={cx('h-1 rounded-full', state === 'idle' ? 'bg-surface-3' : 'bg-accent')}
              />
              <span
                className={cx(
                  'text-footnote',
                  state === 'current' ? 'font-semibold text-text' : 'text-text-2',
                )}
              >
                {n}. {label}
              </span>
            </li>
          );
        })}
      </ol>

      {error && !failed && (
        <Banner tone="error" title="That didn’t work" className="mb-4">
          {error}
        </Banner>
      )}

      {failed ? (
        <FailurePanel reason={peer?.failureReason} onRetry={restart} />
      ) : phase && isReadyPhase(phase) ? (
        <SuccessPanel name={peer?.remote?.name ?? 'the other device'} next={next} mode={mode} />
      ) : phase === 'verifying' && peer ? (
        <VerificationPanel
          peer={peer}
          onConfirm={() => peerManager.confirm(peer.id, true)}
          onReject={() => peerManager.confirm(peer.id, false)}
        />
      ) : mode === 'show' ? (
        <ShowFlow
          parts={parts}
          expiresAt={peer?.expiresAt ?? 0}
          scanningReply={scanningReply}
          connecting={phase === 'connecting'}
          remoteName={peer?.remote?.name}
          busy={busy}
          progress={progress}
          onScanReply={() => {
            setError(null);
            setScanningReply(true);
          }}
          onBack={() => setScanningReply(false)}
          onCode={handleCode}
          onNewCode={restart}
          autoReply={quickConnect}
        />
      ) : (
        <ScanFlow
          parts={parts}
          expiresAt={peer?.expiresAt ?? 0}
          remoteName={peer?.remote?.name}
          connecting={phase === 'connecting'}
          busy={busy}
          progress={progress}
          onCode={handleCode}
          onStream={(s) => (camera.current = s)}
          onRescan={restart}
          reply={reply}
        />
      )}
    </div>
  );
}

function ShowFlow(props: {
  parts: string[] | null;
  expiresAt: number;
  scanningReply: boolean;
  connecting: boolean;
  remoteName?: string;
  busy: boolean;
  progress: { received: number; total: number } | null;
  onScanReply: () => void;
  onBack: () => void;
  onCode: (text: string, manual?: boolean) => void;
  onNewCode: () => void;
  autoReply: boolean;
}) {
  const now = useNow(1000);
  if (props.connecting) return <Connecting name={props.remoteName} />;
  if (!props.parts) {
    return (
      <div className="flex flex-col items-center gap-3 py-16" role="status">
        <Spinner className="size-7" />
        <p className="text-callout text-text-2">Preparing a secure pairing code…</p>
      </div>
    );
  }
  const expired = props.expiresAt > 0 && now > props.expiresAt;
  if (props.scanningReply) {
    return (
      <div className="space-y-4">
        <QrScanner
          instruction="Point the camera at the reply code on the other device."
          onScan={(t) => props.onCode(t)}
          onManual={(t) => props.onCode(t, true)}
          paused={props.busy}
          progress={props.progress}
        />
        <Button variant="plain" block onClick={props.onBack}>
          Show My Code Again
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <p className="text-center text-body text-text-2">
        On the other device, open FileShare and tap{' '}
        <strong className="text-text">Send › Scan Device</strong>.{' '}
        {props.autoReply
          ? 'It connects automatically after scanning.'
          : 'Then scan the code it shows in reply.'}
      </p>
      <QrDisplay
        parts={props.parts}
        expiresAt={props.expiresAt}
        label="Pairing code for this device"
      />
      {expired ? (
        <Button size="lg" block icon={<RefreshCw className="size-5" />} onClick={props.onNewCode}>
          Create New Code
        </Button>
      ) : props.autoReply ? (
        <div className="space-y-1 text-center">
          <p
            className="flex items-center justify-center gap-2 text-callout text-text-2"
            role="status"
          >
            <Spinner className="size-4" /> Waiting for the other device to scan…
          </p>
          <Button variant="plain" onClick={props.onScanReply}>
            No internet? Scan Its Reply Code
          </Button>
        </div>
      ) : (
        <Button size="lg" block onClick={props.onScanReply}>
          Scan Reply
        </Button>
      )}
    </div>
  );
}

function ScanFlow(props: {
  parts: string[] | null;
  expiresAt: number;
  remoteName?: string;
  connecting: boolean;
  busy: boolean;
  progress: { received: number; total: number } | null;
  onCode: (text: string, manual?: boolean) => void;
  onStream: (s: MediaStream | null) => void;
  onRescan: () => void;
  reply: 'none' | 'sending' | 'sent' | 'failed';
}) {
  const [showCode, setShowCode] = useState(false);
  if (!props.parts) {
    return (
      <QrScanner
        instruction="On the other device, tap Receive › Pair New Device, then point this camera at its code."
        onScan={(t) => props.onCode(t)}
        onManual={(t) => props.onCode(t, true)}
        onStream={props.onStream}
        paused={props.busy}
        progress={props.progress}
      />
    );
  }
  const name = props.remoteName ?? 'the other device';
  if ((props.reply === 'sending' || props.reply === 'sent') && !showCode) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center" role="status">
        <Spinner className="size-7" />
        <p className="text-headline font-semibold text-text">
          {props.connecting || props.reply === 'sent' ? `Connecting to ${name}…` : 'Sending reply…'}
        </p>
        <p className="max-w-xs text-callout text-text-2">
          No need to scan anything on {name}. This usually takes a few seconds.
        </p>
        <Button variant="plain" onClick={() => setShowCode(true)}>
          Not connecting? Show Reply Code
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {props.reply === 'failed' && (
        <Banner tone="info">
          Couldn’t send the reply automatically (no internet?). Show this code to {name} instead.
        </Banner>
      )}
      <p className="text-center text-body text-text-2">
        Now hold this screen up to{' '}
        <strong className="text-text">{props.remoteName ?? 'the other device'}</strong> and tap{' '}
        <strong className="text-text">Scan Reply</strong> there.
      </p>
      <QrDisplay
        parts={props.parts}
        expiresAt={props.expiresAt}
        label="Reply code for the other device"
      />
      <p className="flex items-center justify-center gap-2 text-callout text-text-2" role="status">
        <Spinner className="size-4" />
        {props.connecting
          ? 'Connecting…'
          : `Waiting for ${props.remoteName ?? 'the other device'}…`}
      </p>
      <Button variant="plain" block onClick={props.onRescan}>
        Scan a Different Code
      </Button>
    </div>
  );
}

function Connecting({ name }: { name?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center" role="status">
      <Spinner className="size-7" />
      <p className="text-headline font-semibold text-text">
        Connecting to {name ?? 'the other device'}…
      </p>
      <p className="max-w-xs text-callout text-text-2">
        Looking for a direct route over your local network.
      </p>
    </div>
  );
}

function SuccessPanel({ name, next, mode }: { name: string; next: string; mode: Mode }) {
  return (
    <div className="flex flex-col items-center py-10 text-center" role="status">
      <CheckCircle2 className="size-14 text-success" aria-hidden />
      <p className="mt-4 text-title font-semibold text-text">Connected to {name}</p>
      <p className="mt-1 max-w-sm text-callout text-text-2">
        The connection is direct and encrypted. Keep FileShare open on both devices while you share.
      </p>
      <div className="mt-8 w-full max-w-sm space-y-2">
        <Link
          to={next}
          replace
          className="flex min-h-[3.25rem] w-full items-center justify-center rounded-[var(--radius-control)] bg-accent-fill px-5 text-headline font-semibold text-on-accent"
        >
          {mode === 'scan' ? 'Choose Files' : 'Done'}
        </Link>
      </div>
    </div>
  );
}

function FailurePanel({ reason, onRetry }: { reason?: string | null; onRetry: () => void }) {
  return (
    <div className="space-y-4">
      <Banner tone="error" title="Couldn’t connect">
        {reason ?? 'The pairing attempt ended.'}
      </Banner>
      <Button size="lg" block icon={<RefreshCw className="size-5" />} onClick={onRetry}>
        Try Again
      </Button>
      <Link
        to="/settings/diagnostics"
        className="flex min-h-11 items-center justify-center text-callout font-medium text-accent"
      >
        View Connection Diagnostics
      </Link>
    </div>
  );
}

function messageOf(e: unknown): string {
  if (e instanceof PairingCodeError) return e.message;
  if (e instanceof Error && e.message && e.message.length < 240) return e.message;
  return 'Something went wrong while pairing. Try again.';
}
