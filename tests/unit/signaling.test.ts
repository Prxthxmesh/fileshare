// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  compactCandidate,
  compactSdp,
  expandCandidate,
  expandSdp,
  fingerprintFromSdp,
  sdpFromPayload,
  summarizeCandidates,
  validateCompactSdp,
} from '@/services/webrtc/signaling';

// Shape of a real Chrome data-channel offer after ICE gathering (values altered).
const CHROME_OFFER = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 51234 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 192.168.1.23',
  'a=candidate:1467250027 1 udp 2122260223 192.168.1.23 51234 typ host generation 0 network-id 1 network-cost 10',
  'a=candidate:3213129383 1 udp 2122194687 4b7b3c86-62a4-4a40-8a64-3b6b3a1fd9a1.local 51235 typ host generation 0 network-id 2',
  'a=candidate:182393447 1 tcp 1518280447 192.168.1.23 9 typ host tcptype active generation 0 network-id 1 network-cost 10',
  'a=candidate:842163049 1 udp 1686052607 203.0.113.7 51234 typ srflx raddr 192.168.1.23 rport 51234 generation 0 network-id 1',
  'a=ice-ufrag:Xq7d',
  'a=ice-pwd:8sF3n0pZx2aQ9vB1kL4mT7yR',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

// Firefox puts the fingerprint at session level and uses longer credentials.
const FIREFOX_ANSWER = [
  'v=0',
  'o=mozilla...THIS_IS_SDPARTA-99.0 7166233462939212480 0 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
  'a=group:BUNDLE 0',
  'a=ice-options:trickle',
  'a=msid-semantic:WMS *',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:0 1 UDP 2122252543 10.0.0.5 60001 typ host',
  'a=candidate:1 1 TCP 2105524479 10.0.0.5 9 typ host tcptype active',
  'a=sendrecv',
  'a=end-of-candidates',
  'a=ice-pwd:3f0d6a9e5c1b2a4d8e7f6c5b4a3d2e1f',
  'a=ice-ufrag:9c2f1e3a',
  'a=mid:0',
  'a=setup:active',
  'a=sctp-port:5000',
  'a=max-message-size:1073741823',
  '',
].join('\r\n');

describe('compact SDP', () => {
  it('compacts a Chrome offer and keeps every candidate', () => {
    const payload = compactSdp(CHROME_OFFER);
    expect('compact' in payload).toBe(true);
    if (!('compact' in payload)) return;
    const c = payload.compact;
    expect(c.u).toBe('Xq7d');
    expect(c.p).toBe('8sF3n0pZx2aQ9vB1kL4mT7yR');
    expect(c.s).toBe('actpass');
    expect(c.m).toBe('0');
    expect(c.sp).toBe(5000);
    expect(c.mm).toBe(262144);
    expect(c.c).toHaveLength(4);
    expect(JSON.stringify(c).length).toBeLessThan(CHROME_OFFER.length / 1.8);
  });

  it('round-trips the security-relevant fields', () => {
    const payload = compactSdp(CHROME_OFFER);
    const rebuilt = sdpFromPayload(payload);
    expect(fingerprintFromSdp(rebuilt)).toBe(fingerprintFromSdp(CHROME_OFFER));
    expect(rebuilt).toContain('a=ice-ufrag:Xq7d');
    expect(rebuilt).toContain('a=ice-pwd:8sF3n0pZx2aQ9vB1kL4mT7yR');
    expect(rebuilt).toContain('a=setup:actpass');
    expect(rebuilt).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
    expect(summarizeCandidates(rebuilt)).toEqual(summarizeCandidates(CHROME_OFFER));
  });

  it('keeps related address and tcptype on candidates', () => {
    const srflx = compactCandidate(
      'a=candidate:842163049 1 udp 1686052607 203.0.113.7 51234 typ srflx raddr 192.168.1.23 rport 51234 generation 0',
    );
    expect(srflx).toBe(
      '842163049 1 udp 1686052607 203.0.113.7 51234 srflx raddr 192.168.1.23 rport 51234',
    );
    expect(expandCandidate(srflx)).toBe(
      'candidate:842163049 1 udp 1686052607 203.0.113.7 51234 typ srflx raddr 192.168.1.23 rport 51234',
    );
    const tcp = compactCandidate('candidate:1 1 TCP 2105524479 10.0.0.5 9 typ host tcptype active');
    expect(expandCandidate(tcp)).toContain('tcptype active');
  });

  it('handles Firefox session-level fingerprints', () => {
    const payload = compactSdp(FIREFOX_ANSWER);
    expect('compact' in payload).toBe(true);
    const rebuilt = sdpFromPayload(payload);
    expect(fingerprintFromSdp(rebuilt)).toBe(fingerprintFromSdp(FIREFOX_ANSWER));
    expect(rebuilt).toContain('a=setup:active');
    expect(summarizeCandidates(rebuilt).total).toBe(2);
  });

  it('falls back to the full SDP for shapes it does not understand', () => {
    const withAudio = CHROME_OFFER.replace(
      'm=application',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:1\r\nm=application',
    );
    const payload = compactSdp(withAudio);
    expect('full' in payload).toBe(true);
    const sha1 = CHROME_OFFER.replace('sha-256', 'sha-1');
    expect('full' in compactSdp(sha1)).toBe(true);
  });

  it('rejects malformed compact payloads', () => {
    expect(() =>
      validateCompactSdp({ u: 'x', p: 'y', f: 'z', s: 'actpass', m: '0', sp: 5000, c: [] }),
    ).toThrow();
    expect(() => expandCandidate('1 1 udp 1 <script> 5 host')).toThrow();
    expect(() => expandCandidate('1 1 udp 1 10.0.0.1 5 weird')).toThrow();
    expect(() => expandCandidate('1 1 sctp 1 10.0.0.1 5 host')).toThrow();
  });

  it('rejects injected SDP lines inside fields', () => {
    const payload = compactSdp(CHROME_OFFER);
    if (!('compact' in payload)) throw new Error('expected compact');
    const evil = { ...payload.compact, u: 'Xq7d\r\na=setup:passive' };
    expect(() => expandSdp(evil)).toThrow();
  });
});
