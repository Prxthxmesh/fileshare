// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PAIRING_TTL_MS } from '@/constants';
import {
  assertNotExpired,
  ReplayGuard,
  verificationCode,
} from '@/services/pairing/pairingSecurity';
import {
  decodePayload,
  encodePayload,
  PairingCodeError,
  PartCollector,
  toQrParts,
  type PairingPayload,
} from '@/services/pairing/pairingSession';

const FP_A = 'A'.repeat(64);
const FP_B = '0123456789ABCDEF'.repeat(4);

function payload(overrides: Partial<PairingPayload> = {}): PairingPayload {
  return {
    v: 1,
    k: 'offer',
    sid: 'abcdEFGH1234',
    exp: Date.now() + PAIRING_TTL_MS,
    d: 'device-abcdefgh',
    n: 'Test iPad',
    dk: 'tablet',
    pf: 'iPad',
    sdp: {
      compact: {
        u: 'Xq7d',
        p: '8sF3n0pZx2aQ9vB1kL4mT7yR',
        f: FP_A,
        s: 'actpass',
        m: '0',
        sp: 5000,
        mm: 262144,
        c: ['1467250027 1 udp 2122260223 192.168.1.23 51234 host'],
      },
    },
    ...overrides,
  };
}

describe('pairing payload encoding', () => {
  it('round-trips through the QR text format', async () => {
    const p = payload();
    const data = await encodePayload(p);
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodePayload(data)).toEqual(p);
  });

  it('fits a typical payload into a single, small QR code', async () => {
    const parts = toQrParts(await encodePayload(payload()));
    expect(parts).toHaveLength(1);
    expect(parts[0].length).toBeLessThan(400);
  });

  it('detects corruption via the integrity check', async () => {
    const data = await encodePayload(payload());
    const i = Math.floor(data.length / 2);
    const corrupted = data.slice(0, i) + (data[i] === 'A' ? 'B' : 'A') + data.slice(i + 1);
    await expect(decodePayload(corrupted)).rejects.toMatchObject({ code: 'corrupted' });
  });

  it('rejects other versions and malformed fields', async () => {
    await expect(decodePayload(await encodePayload({ ...payload(), v: 2 }))).rejects.toMatchObject({
      code: 'unsupported-version',
    });
    await expect(
      decodePayload(await encodePayload({ ...payload(), sid: 'x' })),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(decodePayload('not base64!')).rejects.toBeInstanceOf(PairingCodeError);
  });
});

describe('multipart QR', () => {
  const data = 'x'.repeat(1700);

  it('splits without truncating and reassembles out of order with duplicates', () => {
    const parts = toQrParts(data, 600);
    expect(parts.length).toBe(3);
    expect(parts.every((p) => p.length <= 600)).toBe(true);
    const c = new PartCollector();
    expect(c.add(parts[2])).toEqual({ status: 'partial', received: 1, total: 3 });
    expect(c.add(parts[2])).toEqual({ status: 'ignored' });
    expect(c.add(parts[0])).toEqual({ status: 'partial', received: 2, total: 3 });
    expect(c.add(parts[1])).toEqual({ status: 'complete', data });
  });

  it('accepts all parts pasted at once', () => {
    const parts = toQrParts(data, 600);
    expect(new PartCollector().addMany(parts.reverse().join('\n'))).toEqual({
      status: 'complete',
      data,
    });
  });

  it('starts over when a different code set is scanned', () => {
    const first = toQrParts(data, 600);
    const second = toQrParts(data, 600);
    const c = new PartCollector();
    c.add(first[0]);
    expect(c.add(second[1])).toEqual({ status: 'partial', received: 1, total: 3 });
  });

  it('rejects non-FileShare QR codes', () => {
    expect(() => new PartCollector().add('https://example.com')).toThrow(PairingCodeError);
  });
});

describe('pairing security', () => {
  it('derives the same verification code on both sides', async () => {
    const a = await verificationCode('sid12345', FP_A, FP_B);
    const b = await verificationCode('sid12345', FP_B, FP_A);
    expect(a).toBe(b);
    expect(a).toMatch(/^\d{6}$/);
  });

  it('changes the code when any input changes', async () => {
    const base = await verificationCode('sid12345', FP_A, FP_B);
    expect(await verificationCode('sid12346', FP_A, FP_B)).not.toBe(base);
    expect(await verificationCode('sid12345', FP_A, FP_B.replace('0', '1'))).not.toBe(base);
  });

  it('rejects expired codes and tolerates small clock skew', () => {
    const now = Date.now();
    expect(() => assertNotExpired(payload({ exp: now - 60_000 }), now)).not.toThrow();
    expect(() => assertNotExpired(payload({ exp: now - 10 * 60_000 }), now)).toThrow(/expired/);
    expect(() => assertNotExpired(payload({ exp: now - 1 }), now, true)).toThrow(/expired/);
    expect(() => assertNotExpired(payload({ exp: now + 60 * 60_000 }), now)).toThrow();
  });

  it('blocks replays of an already-used session', () => {
    const guard = new ReplayGuard('test-replay');
    guard.consume('sessionA1', Date.now() + 1000);
    expect(() => guard.consume('sessionA1', Date.now() + 1000)).toThrow(/already used/);
    expect(() => guard.consume('sessionB1', Date.now() + 1000)).not.toThrow();
  });
});
