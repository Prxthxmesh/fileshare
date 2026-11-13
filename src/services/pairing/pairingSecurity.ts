import { PAIRING_CLOCK_SKEW_MS, PAIRING_TTL_MS } from '@/constants';
import { sha256Bytes, utf8Encode } from '@/utils/encoding';
import { PairingCodeError, type PairingPayload } from './pairingSession';

export function pairingExpiry(now = Date.now()): number {
  return now + PAIRING_TTL_MS;
}

/** Rejects codes past their expiry, allowing for modest clock differences between devices. */
export function assertNotExpired(payload: PairingPayload, now = Date.now(), ownClock = false) {
  const skew = ownClock ? 0 : PAIRING_CLOCK_SKEW_MS;
  if (now > payload.exp + skew) {
    throw new PairingCodeError(
      'This pairing code has expired. Create a new code on the other device.',
      'expired',
    );
  }
  // A code claiming to be valid far into the future is malformed.
  if (payload.exp - now > PAIRING_TTL_MS + skew) {
    throw new PairingCodeError('Invalid pairing code.', 'invalid');
  }
}

/**
 * Remembers which offer codes this device has already answered, so the same
 * QR code can't be replayed to open a second connection. Kept in
 * sessionStorage for the lifetime of the tab, and pruned on expiry.
 */
export class ReplayGuard {
  private readonly key: string;
  private used = new Map<string, number>();

  constructor(key = 'fileshare.usedPairingSessions') {
    this.key = key;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) this.used = new Map(JSON.parse(raw) as [string, number][]);
    } catch {
      this.used = new Map();
    }
  }

  private persist() {
    try {
      sessionStorage.setItem(this.key, JSON.stringify([...this.used]));
    } catch {
      // sessionStorage may be unavailable (private mode); in-memory guard still applies.
    }
  }

  private prune(now: number) {
    for (const [sid, exp] of this.used) {
      if (exp + PAIRING_CLOCK_SKEW_MS < now) this.used.delete(sid);
    }
  }

  has(sid: string): boolean {
    return this.used.has(sid);
  }

  /** Throws if the session id was already used; otherwise records it. */
  consume(sid: string, exp: number, now = Date.now()) {
    this.prune(now);
    if (this.used.has(sid)) {
      throw new PairingCodeError(
        'This code was already used. Create a new code on the other device.',
        'replayed',
      );
    }
    this.used.set(sid, exp);
    this.persist();
  }
}

/**
 * Short authentication string shown on both devices. Derived from the pairing
 * session id and both DTLS certificate fingerprints. The fingerprints are what
 * the encrypted DTLS connection is actually bound to, so if both screens show
 * the same code, both devices are talking to each other — not to a third
 * device that intercepted or substituted a QR code.
 */
export async function verificationCode(sid: string, fingerprintA: string, fingerprintB: string) {
  const [a, b] = [fingerprintA.toUpperCase(), fingerprintB.toUpperCase()].sort();
  const digest = await sha256Bytes(utf8Encode(`fileshare-v1|${sid}|${a}|${b}`));
  const n = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}

export function formatVerificationCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** Short fingerprint for display in device details, e.g. "3F:A2:91:0C". */
export function shortFingerprint(fp: string | undefined): string {
  if (!fp) return '—';
  return fp.slice(0, 8).match(/.{2}/g)!.join(':');
}
