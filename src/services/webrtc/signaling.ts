/**
 * Compact SDP serialization for QR-based signaling.
 *
 * A data-channel-only SDP from Chrome/Safari/Firefox is 600–1500 characters,
 * most of which is boilerplate. The only session-specific values are the ICE
 * credentials, the DTLS fingerprint and setup role, the media id, the SCTP
 * parameters and the ICE candidates. We transmit those and rebuild a standard
 * SDP on the other side.
 *
 * Safety rules:
 *  - Every candidate is kept. Only non-essential candidate extension
 *    attributes (generation, network-id, network-cost, ufrag) are dropped.
 *  - If the SDP has any shape we don't fully understand (more than one m-line,
 *    non-data-channel media, a non-SHA-256 fingerprint, missing credentials),
 *    we fall back to sending the full SDP verbatim. We never truncate.
 */

export interface CompactSdp {
  /** ice-ufrag */
  u: string;
  /** ice-pwd */
  p: string;
  /** DTLS fingerprint, sha-256, hex without colons, uppercase */
  f: string;
  /** DTLS setup role */
  s: 'actpass' | 'active' | 'passive';
  /** media id */
  m: string;
  /** sctp-port */
  sp: number;
  /** max-message-size, if present */
  mm?: number;
  /** candidates, compact form */
  c: string[];
}

export type SdpPayload = { compact: CompactSdp } | { full: string };

export class SdpFormatError extends Error {}

function lines(sdp: string): string[] {
  return sdp
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function attr(all: string[], name: string): string | undefined {
  const prefix = `a=${name}:`;
  const line = all.find((l) => l.startsWith(prefix));
  return line?.slice(prefix.length).trim();
}

const KEEP_CANDIDATE_EXT = new Set(['raddr', 'rport', 'tcptype']);

/** "candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host generation 0" → "1 1 udp 2122260223 192.168.1.5 54321 host" */
export function compactCandidate(line: string): string {
  const body = line.replace(/^a=/, '').replace(/^candidate:/, '');
  const tokens = body.split(/\s+/);
  if (tokens.length < 8 || tokens[6] !== 'typ') throw new SdpFormatError('Unrecognised candidate');
  const [foundation, component, transport, priority, address, port, , type] = tokens;
  const out = [foundation, component, transport.toLowerCase(), priority, address, port, type];
  for (let i = 8; i + 1 < tokens.length; i += 2) {
    if (KEEP_CANDIDATE_EXT.has(tokens[i])) out.push(tokens[i], tokens[i + 1]);
  }
  return out.join(' ');
}

export function expandCandidate(compact: string): string {
  const tokens = compact.split(' ');
  if (tokens.length < 7 || tokens.length % 2 === 0) throw new SdpFormatError('Invalid candidate');
  const [foundation, component, transport, priority, address, port, type, ...ext] = tokens;
  if (!/^\d+$/.test(component) || !/^\d+$/.test(priority) || !/^\d+$/.test(port)) {
    throw new SdpFormatError('Invalid candidate numbers');
  }
  if (!/^(udp|tcp)$/.test(transport)) throw new SdpFormatError('Invalid candidate transport');
  if (!/^(host|srflx|prflx|relay)$/.test(type)) throw new SdpFormatError('Invalid candidate type');
  if (!/^[A-Za-z0-9+/:.%-]{1,64}$/.test(address) || !/^[A-Za-z0-9+/]{1,32}$/.test(foundation)) {
    throw new SdpFormatError('Invalid candidate address');
  }
  for (const t of ext) {
    if (!/^[A-Za-z0-9.:-]{1,64}$/.test(t)) throw new SdpFormatError('Invalid candidate extension');
  }
  return `candidate:${foundation} ${component} ${transport} ${priority} ${address} ${port} typ ${type}${ext.length ? ' ' + ext.join(' ') : ''}`;
}

/** Returns a compact representation, or `{ full }` when the SDP isn't a plain data-channel SDP. */
export function compactSdp(sdp: string): SdpPayload {
  try {
    return { compact: compactSdpStrict(sdp) };
  } catch {
    return { full: sdp };
  }
}

export function compactSdpStrict(sdp: string): CompactSdp {
  const all = lines(sdp);
  const mLines = all.filter((l) => l.startsWith('m='));
  if (
    mLines.length !== 1 ||
    !/^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel$/.test(mLines[0])
  ) {
    throw new SdpFormatError('Not a single data-channel m-line');
  }
  const u = attr(all, 'ice-ufrag');
  const p = attr(all, 'ice-pwd');
  const fp = attr(all, 'fingerprint');
  const setup = attr(all, 'setup');
  const mid = attr(all, 'mid');
  const sctpPort = attr(all, 'sctp-port');
  const maxMsg = attr(all, 'max-message-size');
  if (!u || !p || !fp || !setup || mid == null || !sctpPort)
    throw new SdpFormatError('Missing fields');
  // Exactly one set of credentials/fingerprints, otherwise we'd lose information.
  if (all.filter((l) => l.startsWith('a=ice-ufrag:')).length !== 1)
    throw new SdpFormatError('ufrag');
  if (all.filter((l) => l.startsWith('a=fingerprint:')).length !== 1)
    throw new SdpFormatError('fp');
  const [alg, hash] = fp.split(/\s+/);
  if (alg.toLowerCase() !== 'sha-256' || !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(hash)) {
    throw new SdpFormatError('Unsupported fingerprint');
  }
  if (setup !== 'actpass' && setup !== 'active' && setup !== 'passive')
    throw new SdpFormatError('setup');
  if (!/^\d+$/.test(sctpPort) || (maxMsg && !/^\d+$/.test(maxMsg)))
    throw new SdpFormatError('sctp');
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(mid)) throw new SdpFormatError('mid');
  const c = all.filter((l) => l.startsWith('a=candidate:')).map(compactCandidate);
  return {
    u,
    p,
    f: hash.replace(/:/g, '').toUpperCase(),
    s: setup,
    m: mid,
    sp: Number(sctpPort),
    ...(maxMsg ? { mm: Number(maxMsg) } : {}),
    c,
  };
}

function fingerprintWithColons(hex: string): string {
  return hex.match(/.{2}/g)!.join(':');
}

/** Rebuilds a standards-compliant data-channel SDP from the compact form. */
export function expandSdp(c: CompactSdp): string {
  validateCompactSdp(c);
  const sessionId = String(Math.floor(Math.random() * 1e15)).padStart(15, '1');
  const out = [
    'v=0',
    `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    `a=group:BUNDLE ${c.m}`,
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...c.c.map((cand) => `a=${expandCandidate(cand)}`),
    `a=ice-ufrag:${c.u}`,
    `a=ice-pwd:${c.p}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fingerprintWithColons(c.f)}`,
    `a=setup:${c.s}`,
    `a=mid:${c.m}`,
    `a=sctp-port:${c.sp}`,
    ...(c.mm ? [`a=max-message-size:${c.mm}`] : []),
    'a=end-of-candidates',
  ];
  return out.join('\r\n') + '\r\n';
}

export function validateCompactSdp(c: unknown): asserts c is CompactSdp {
  if (!c || typeof c !== 'object') throw new SdpFormatError('Missing SDP');
  const s = c as Record<string, unknown>;
  // ICE credentials: RFC 8839 ice-char = ALPHA / DIGIT / "+" / "/"
  if (typeof s.u !== 'string' || !/^[A-Za-z0-9+/]{4,256}$/.test(s.u))
    throw new SdpFormatError('ufrag');
  if (typeof s.p !== 'string' || !/^[A-Za-z0-9+/]{22,256}$/.test(s.p))
    throw new SdpFormatError('pwd');
  if (typeof s.f !== 'string' || !/^[0-9A-F]{64}$/.test(s.f))
    throw new SdpFormatError('fingerprint');
  if (s.s !== 'actpass' && s.s !== 'active' && s.s !== 'passive') throw new SdpFormatError('setup');
  if (typeof s.m !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(s.m))
    throw new SdpFormatError('mid');
  if (typeof s.sp !== 'number' || !Number.isInteger(s.sp) || s.sp < 1 || s.sp > 65535) {
    throw new SdpFormatError('sctp-port');
  }
  if (s.mm != null && (typeof s.mm !== 'number' || !Number.isInteger(s.mm) || s.mm < 0)) {
    throw new SdpFormatError('max-message-size');
  }
  if (!Array.isArray(s.c) || s.c.length > 64 || s.c.some((x) => typeof x !== 'string')) {
    throw new SdpFormatError('candidates');
  }
}

/** Basic structural validation for verbatim SDP received over the pairing channel. */
export function validateFullSdp(sdp: unknown): asserts sdp is string {
  if (typeof sdp !== 'string' || sdp.length > 16_000 || !sdp.startsWith('v=0')) {
    throw new SdpFormatError('Invalid SDP');
  }
  if (!/\r?\nm=application /.test(sdp) || !/a=fingerprint:/.test(sdp)) {
    throw new SdpFormatError('SDP is not a data-channel session');
  }
}

export function sdpFromPayload(payload: SdpPayload): string {
  if ('compact' in payload) return expandSdp(payload.compact);
  validateFullSdp(payload.full);
  return payload.full;
}

/** Extracts the sha-256 DTLS fingerprint (uppercase hex, no colons) from an SDP. */
export function fingerprintFromSdp(sdp: string): string | null {
  const match = /a=fingerprint:sha-256 ([0-9A-F:]+)/i.exec(sdp);
  return match ? match[1].replace(/:/g, '').toUpperCase() : null;
}

export interface CandidateSummary {
  total: number;
  host: number;
  mdns: number;
  srflx: number;
  relay: number;
  prflx: number;
  tcp: number;
}

export function summarizeCandidates(sdp: string): CandidateSummary {
  const summary: CandidateSummary = {
    total: 0,
    host: 0,
    mdns: 0,
    srflx: 0,
    relay: 0,
    prflx: 0,
    tcp: 0,
  };
  for (const line of lines(sdp)) {
    if (!line.startsWith('a=candidate:')) continue;
    const t = line.split(/\s+/);
    summary.total++;
    const type = t[7] as 'host' | 'srflx' | 'relay' | 'prflx';
    if (type in summary) summary[type]++;
    if (t[4]?.endsWith('.local')) summary.mdns++;
    if (t[2]?.toLowerCase() === 'tcp') summary.tcp++;
  }
  return summary;
}
