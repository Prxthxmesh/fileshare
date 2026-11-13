import { PAIRING_VERSION, QR_PART_MAX_CHARS } from '@/constants';
import type { DeviceKind } from '@/types';
import {
  base64UrlDecode,
  base64UrlEncode,
  compressionSupported,
  deflate,
  inflate,
  randomId,
  sha256Bytes,
  utf8Decode,
  utf8Encode,
} from '@/utils/encoding';
import { validateCompactSdp, validateFullSdp, type SdpPayload } from '../webrtc/signaling';

/**
 * Pairing payload: everything one device must hand to the other, out of band,
 * to set up a WebRTC connection without a signaling server.
 *
 * Wire text format
 *   single part:  FS1.<data>
 *   multipart:    FS1M.<group>.<index>.<total>.<slice of data>
 *
 * <data> = base64url( flags(1) | check(4) | body )
 *   flags bit0 = body is deflate-raw compressed
 *   check      = first 4 bytes of SHA-256(body) — detects corrupted/mixed-up scans
 *   body       = UTF-8 JSON of PairingPayload
 */
export interface PairingPayload {
  v: number;
  /** offer (shown by the receiving device) or answer (shown by the scanning device) */
  k: 'offer' | 'answer';
  /** pairing session id, shared by the offer and its answer */
  sid: string;
  /** expiry, unix ms (creator's clock) */
  exp: number;
  /** creator device id */
  d: string;
  /** creator device name */
  n: string;
  /** creator device kind */
  dk: DeviceKind;
  /** creator platform label */
  pf: string;
  sdp: SdpPayload;
}

export class PairingCodeError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not-fileshare'
      | 'corrupted'
      | 'unsupported-version'
      | 'invalid'
      | 'expired'
      | 'wrong-kind'
      | 'replayed'
      | 'mismatched-session'
      | 'incomplete',
  ) {
    super(message);
  }
}

const FLAG_DEFLATE = 1;

export async function encodePayload(payload: PairingPayload): Promise<string> {
  const json = utf8Encode(JSON.stringify(payload));
  let body = json;
  let flags = 0;
  if (compressionSupported()) {
    const compressed = await deflate(json);
    if (compressed.length < json.length) {
      body = compressed;
      flags |= FLAG_DEFLATE;
    }
  }
  const check = (await sha256Bytes(body)).subarray(0, 4);
  const framed = new Uint8Array(1 + 4 + body.length);
  framed[0] = flags;
  framed.set(check, 1);
  framed.set(body, 5);
  return base64UrlEncode(framed);
}

export async function decodePayload(data: string): Promise<PairingPayload> {
  let framed: Uint8Array;
  try {
    framed = base64UrlDecode(data);
  } catch {
    throw new PairingCodeError('This code is damaged or incomplete.', 'corrupted');
  }
  if (framed.length < 6 || framed.length > 32_000) {
    throw new PairingCodeError('This code is damaged or incomplete.', 'corrupted');
  }
  const flags = framed[0];
  const check = framed.subarray(1, 5);
  const body = framed.subarray(5);
  const actual = (await sha256Bytes(body)).subarray(0, 4);
  if (!actual.every((b, i) => b === check[i])) {
    throw new PairingCodeError('This code is damaged or incomplete.', 'corrupted');
  }
  let json: Uint8Array = body;
  if (flags & FLAG_DEFLATE) {
    if (!compressionSupported()) {
      throw new PairingCodeError(
        'This browser can’t read compressed pairing codes. Update the browser and try again.',
        'unsupported-version',
      );
    }
    try {
      json = await inflate(body);
    } catch {
      throw new PairingCodeError('This code is damaged or incomplete.', 'corrupted');
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(json));
  } catch {
    throw new PairingCodeError('This code is damaged or incomplete.', 'corrupted');
  }
  return validatePayload(parsed);
}

export function validatePayload(raw: unknown): PairingPayload {
  if (!raw || typeof raw !== 'object')
    throw new PairingCodeError('Invalid pairing code.', 'invalid');
  const p = raw as Record<string, unknown>;
  if (p.v !== PAIRING_VERSION) {
    throw new PairingCodeError(
      'This code comes from a different version of FileShare. Update both devices and try again.',
      'unsupported-version',
    );
  }
  const fail = () => {
    throw new PairingCodeError('Invalid pairing code.', 'invalid');
  };
  if (p.k !== 'offer' && p.k !== 'answer') fail();
  if (typeof p.sid !== 'string' || !/^[A-Za-z0-9_-]{8,32}$/.test(p.sid)) fail();
  if (typeof p.exp !== 'number' || !Number.isFinite(p.exp)) fail();
  if (typeof p.d !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(p.d)) fail();
  if (typeof p.n !== 'string' || p.n.length > 60) fail();
  if (!['phone', 'tablet', 'desktop', 'unknown'].includes(p.dk as string)) fail();
  if (typeof p.pf !== 'string' || p.pf.length > 30) fail();
  const sdp = p.sdp as Record<string, unknown> | undefined;
  if (!sdp || typeof sdp !== 'object') fail();
  try {
    if ('compact' in sdp!) validateCompactSdp(sdp.compact);
    else if ('full' in sdp!) validateFullSdp(sdp.full);
    else fail();
  } catch (e) {
    if (e instanceof PairingCodeError) throw e;
    fail();
  }
  return {
    v: p.v as number,
    k: p.k as 'offer' | 'answer',
    sid: p.sid as string,
    exp: p.exp as number,
    d: p.d as string,
    n: (p.n as string).trim() || 'Unnamed device',
    dk: p.dk as DeviceKind,
    pf: p.pf as string,
    sdp: sdp as unknown as SdpPayload,
  };
}

const SINGLE_PREFIX = 'FS1.';
const MULTI_PREFIX = 'FS1M.';

/** Splits encoded data into one or more QR texts. Never truncates. */
export function toQrParts(data: string, maxChars = QR_PART_MAX_CHARS): string[] {
  if (data.length + SINGLE_PREFIX.length <= maxChars) return [SINGLE_PREFIX + data];
  const group = randomId(4);
  const headerRoom = MULTI_PREFIX.length + group.length + 8;
  const sliceLen = Math.max(50, maxChars - headerRoom);
  const total = Math.ceil(data.length / sliceLen);
  if (total > 20) {
    throw new PairingCodeError('The pairing data is too large to show as QR codes.', 'invalid');
  }
  const parts: string[] = [];
  for (let i = 0; i < total; i++) {
    parts.push(
      `${MULTI_PREFIX}${group}.${i + 1}.${total}.${data.slice(i * sliceLen, (i + 1) * sliceLen)}`,
    );
  }
  return parts;
}

export type ScanResult =
  | { status: 'complete'; data: string }
  | { status: 'partial'; received: number; total: number }
  | { status: 'ignored' };

/**
 * Collects QR parts (in any order, duplicates welcome) until the payload is
 * complete. Also accepts manually pasted text, including all parts pasted at
 * once separated by whitespace.
 */
export class PartCollector {
  private group: string | null = null;
  private total = 0;
  private parts = new Map<number, string>();

  reset() {
    this.group = null;
    this.total = 0;
    this.parts.clear();
  }

  get progress() {
    return { received: this.parts.size, total: this.total };
  }

  add(text: string): ScanResult {
    const value = text.trim();
    if (value.startsWith(SINGLE_PREFIX)) {
      return { status: 'complete', data: value.slice(SINGLE_PREFIX.length) };
    }
    if (!value.startsWith(MULTI_PREFIX)) {
      throw new PairingCodeError('This isn’t a FileShare pairing code.', 'not-fileshare');
    }
    const match = /^FS1M\.([A-Za-z0-9_-]{4,12})\.(\d{1,2})\.(\d{1,2})\.([A-Za-z0-9_-]+)$/.exec(
      value,
    );
    if (!match) throw new PairingCodeError('This code is damaged or incomplete.', 'corrupted');
    const [, group, idxStr, totalStr, slice] = match;
    const idx = Number(idxStr);
    const total = Number(totalStr);
    if (total < 1 || total > 20 || idx < 1 || idx > total) {
      throw new PairingCodeError('This code is damaged or incomplete.', 'corrupted');
    }
    if (this.group !== group) {
      // A new code set (e.g. the other device created a fresh code): start over.
      this.reset();
      this.group = group;
      this.total = total;
    }
    if (this.total !== total) throw new PairingCodeError('Mixed-up code parts.', 'corrupted');
    if (this.parts.has(idx)) return { status: 'ignored' };
    this.parts.set(idx, slice);
    if (this.parts.size === total) {
      const data = Array.from({ length: total }, (_, i) => this.parts.get(i + 1)!).join('');
      return { status: 'complete', data };
    }
    return { status: 'partial', received: this.parts.size, total };
  }

  /** For manual entry: feed a block of text that may contain several parts. */
  addMany(text: string): ScanResult {
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0)
      throw new PairingCodeError('Paste the pairing code first.', 'incomplete');
    let last: ScanResult = { status: 'ignored' };
    for (const token of tokens) {
      last = this.add(token);
      if (last.status === 'complete') return last;
    }
    if (last.status === 'ignored') {
      const { received, total } = this.progress;
      return { status: 'partial', received, total };
    }
    return last;
  }
}
