import { BadgeCheck, Check } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Feedback';
import { DeviceGlyph } from '@/components/devices/DeviceIcon';
import { formatVerificationCode } from '@/services/pairing/pairingSecurity';
import { useSettingsStore } from '@/stores/settingsStore';
import type { PeerView } from '@/stores/connectionStore';
import type { DeviceKind } from '@/types';
import { detectPlatform } from '@/utils/device';

/**
 * The handshake. Both devices show the same six digits, derived from the
 * certificates that secure this exact connection. Matching codes prove the
 * two devices are connected to each other and not to an impostor.
 */
export function VerificationPanel({
  peer,
  onConfirm,
  onReject,
}: {
  peer: PeerView;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const localName = useSettingsStore((s) => s.settings.deviceName);
  const localKind = detectPlatform().kind;
  const remoteName = peer.remote?.name ?? 'Other device';
  const code = peer.verificationCode ?? '------';

  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex w-full max-w-md items-center justify-between gap-2" aria-hidden>
        <DeviceTag name={localName} kind={localKind} label="This device" />
        <span className="h-px flex-1 bg-separator" />
        <DeviceTag
          name={remoteName}
          kind={peer.remote?.kind ?? 'unknown'}
          label={peer.remote?.platform ?? ''}
        />
      </div>

      <p className="mt-8 text-callout text-text-2" id="vcode-label">
        Verification code
      </p>
      <p
        className="mt-1 font-mono text-[2.75rem] leading-none font-semibold tracking-[0.08em] text-text tabular"
        aria-labelledby="vcode-label"
        aria-label={`Verification code ${code.split('').join(' ')}`}
      >
        {formatVerificationCode(code)}
      </p>

      {peer.recognised ? (
        <p className="mt-4 inline-flex items-center gap-1.5 text-callout text-success">
          <BadgeCheck className="size-4" aria-hidden /> {remoteName} was verified before and
          presented the same identity.
        </p>
      ) : (
        <p className="mt-4 max-w-sm text-callout text-text-2">
          Check that <strong className="font-semibold text-text">{remoteName}</strong> shows exactly
          the same code. If it doesn’t, someone else may be trying to connect.
        </p>
      )}

      <div className="mt-8 w-full max-w-sm space-y-2">
        {!peer.localConfirmed ? (
          <>
            <Button
              size="lg"
              block
              icon={<Check className="size-5" />}
              onClick={onConfirm}
              data-autofocus
            >
              Codes Match
            </Button>
            <Button variant="destructive-plain" block onClick={onReject}>
              Codes Don’t Match
            </Button>
          </>
        ) : !peer.remoteConfirmed ? (
          <p
            className="flex items-center justify-center gap-2 text-callout text-text-2"
            role="status"
          >
            <Spinner className="size-4" /> Waiting for {remoteName} to confirm…
          </p>
        ) : null}
      </div>
    </div>
  );
}

function DeviceTag({ name, kind, label }: { name: string; kind: DeviceKind; label: string }) {
  return (
    <div className="flex w-32 flex-col items-center gap-1.5">
      <span className="flex size-12 items-center justify-center rounded-full bg-surface text-text-2">
        <DeviceGlyph kind={kind} className="size-6" />
      </span>
      <span className="w-full truncate text-footnote font-semibold text-text">{name}</span>
      {label && <span className="-mt-1 w-full truncate text-caption text-text-2">{label}</span>}
    </div>
  );
}
