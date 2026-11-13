// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  combineHalves,
  decryptMessage,
  deriveLinkKey,
  encryptMessage,
  hexToRendezvous,
  randomSecretHex,
  rendezvousToHex,
  TOPIC_PERIOD_MS,
  topicsFor,
} from '@/services/link/linkCrypto';
import { createEvent, verifyEvent } from '@/services/link/nostr';
import {
  decodePayload,
  encodePayload,
  type PairingPayload,
} from '@/services/pairing/pairingSession';

describe('link crypto', () => {
  it('both devices derive the same secret regardless of order', async () => {
    const a = randomSecretHex();
    const b = randomSecretHex();
    expect(await combineHalves(a, b)).toBe(await combineHalves(b, a));
    expect(await combineHalves(a, b)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('encrypts so only the same link key can read it', async () => {
    const secret = randomSecretHex();
    const key = await deriveLinkKey(secret);
    const ct = await encryptMessage(key, { type: 'presence', from: 'device-abc123', ts: 1 });
    expect(ct).not.toContain('presence');
    expect(await decryptMessage(key, ct)).toEqual({
      type: 'presence',
      from: 'device-abc123',
      ts: 1,
    });
    expect(await decryptMessage(await deriveLinkKey(randomSecretHex()), ct)).toBeNull();
    // Tampering is detected (AES-GCM authentication).
    const tampered = ct.slice(0, -2) + (ct.endsWith('A') ? 'BB' : 'AA');
    expect(await decryptMessage(key, tampered)).toBeNull();
  });

  it('rotates topics hourly and overlaps neighbouring hours', async () => {
    const secret = randomSecretHex();
    const now = 1_800_000_000_000;
    const t1 = await topicsFor(secret, now);
    const t2 = await topicsFor(secret, now + TOPIC_PERIOD_MS);
    expect(t1).toHaveLength(3);
    expect(t1[2]).toBe(t2[1]); // next hour of t1 = current hour of t2
    expect(t1[1]).not.toBe(t2[1]);
    expect(await topicsFor(randomSecretHex(), now)).not.toContain(t1[1]);
  });

  it('round-trips the QR rendezvous secret', () => {
    const hex = randomSecretHex(16);
    const rv = hexToRendezvous(hex);
    expect(rv).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(rendezvousToHex(rv)).toBe(hex);
  });
});

describe('nostr events', () => {
  it('creates validly signed ephemeral events and rejects tampering', () => {
    const e = createEvent('topic123', 'ciphertext');
    expect(e.kind).toBeGreaterThanOrEqual(20000);
    expect(e.kind).toBeLessThan(30000);
    expect(verifyEvent(e)).toBe(true);
    expect(verifyEvent({ ...e, content: 'other' })).toBe(false);
  });
});

describe('pairing code with rendezvous', () => {
  const base: PairingPayload = {
    v: 1,
    k: 'offer',
    sid: 'abcdEFGH1234',
    exp: Date.now() + 60_000,
    d: 'device-abcdefgh',
    n: 'iPad',
    dk: 'tablet',
    pf: 'iPad',
    sdp: {
      compact: {
        u: 'Xq7d',
        p: '8sF3n0pZx2aQ9vB1kL4mT7yR',
        f: 'A'.repeat(64),
        s: 'actpass',
        m: '0',
        sp: 5000,
        c: ['1 1 udp 2122260223 192.168.1.23 51234 host'],
      },
    },
  };

  it('carries the optional rendezvous secret', async () => {
    const rv = hexToRendezvous(randomSecretHex(16));
    expect((await decodePayload(await encodePayload({ ...base, rv }))).rv).toBe(rv);
    expect((await decodePayload(await encodePayload(base))).rv).toBeUndefined();
  });

  it('rejects malformed rendezvous values', async () => {
    await expect(decodePayload(await encodePayload({ ...base, rv: 'short' }))).rejects.toThrow();
  });
});
