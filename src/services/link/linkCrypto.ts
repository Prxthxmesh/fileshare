import {
  base64UrlDecode,
  base64UrlEncode,
  fromHex,
  sha256Bytes,
  toHex,
  utf8Decode,
  utf8Encode,
} from '@/utils/encoding';

/**
 * Keys and topics for "quick connect".
 *
 * Two devices that paired once share a 256-bit link secret (agreed over their
 * verified DataChannel). From it we derive:
 *  - an AES-256-GCM key that encrypts every relay message, so relays (and
 *    anyone else) see only random bytes;
 *  - rendezvous topics that change every hour, so relays can't tell that the
 *    same two devices keep meeting.
 * The same scheme, keyed by a one-time secret printed in the QR code, carries
 * the reply during first pairing (no second scan needed).
 */

export const TOPIC_PERIOD_MS = 60 * 60 * 1000;

export interface LinkKey {
  /** Hex of the 32-byte secret. */
  secret: string;
  key: CryptoKey;
}

export async function deriveLinkKey(secretHex: string): Promise<LinkKey> {
  const material = await sha256Bytes(utf8Encode(`fileshare-link-enc|${secretHex}`));
  const key = await crypto.subtle.importKey('raw', material as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  return { secret: secretHex, key };
}

/** Topics for the previous, current and next period (tolerates clock skew and hour boundaries). */
export async function topicsFor(secretHex: string, now = Date.now()): Promise<string[]> {
  const bucket = Math.floor(now / TOPIC_PERIOD_MS);
  return Promise.all([bucket - 1, bucket, bucket + 1].map((b) => topicForBucket(secretHex, b)));
}

export async function currentTopic(secretHex: string, now = Date.now()): Promise<string> {
  return topicForBucket(secretHex, Math.floor(now / TOPIC_PERIOD_MS));
}

async function topicForBucket(secretHex: string, bucket: number) {
  return toHex(await sha256Bytes(utf8Encode(`fileshare-topic|${bucket}|${secretHex}`))).slice(
    0,
    40,
  );
}

export async function encryptMessage(key: LinkKey, message: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = utf8Encode(JSON.stringify(message));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key.key, data as BufferSource),
  );
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return base64UrlEncode(out);
}

/** Returns the decrypted message, or null if it wasn't encrypted with this key. */
export async function decryptMessage(key: LinkKey, content: string): Promise<unknown | null> {
  try {
    const raw = base64UrlDecode(content);
    if (raw.length < 13 || raw.length > 64 * 1024) return null;
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.subarray(0, 12) as BufferSource },
      key.key,
      raw.subarray(12) as BufferSource,
    );
    return JSON.parse(utf8Decode(new Uint8Array(pt)));
  } catch {
    return null;
  }
}

/** Combines both devices' random halves into one shared secret (order-independent). */
export async function combineHalves(a: string, b: string): Promise<string> {
  const [x, y] = [a, b].sort();
  return toHex(await sha256Bytes(utf8Encode(`fileshare-link|${x}|${y}`)));
}

export function randomSecretHex(bytes = 32): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function isSecretHex(v: unknown, bytes = 32): v is string {
  return typeof v === 'string' && v.length === bytes * 2 && /^[0-9a-f]+$/.test(v);
}

/** Rendezvous secret embedded in a QR offer: 16 bytes, base64url. */
export function rendezvousToHex(rv: string): string {
  return toHex(base64UrlDecode(rv));
}

export function hexToRendezvous(hex: string): string {
  return base64UrlEncode(fromHex(hex));
}
