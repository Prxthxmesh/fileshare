import { randomId } from '@/utils/encoding';
import { kvGet, kvSet } from './indexedDb';

const DEVICE_ID_KEY = 'deviceId';
const CERT_KEY = 'dtlsCertificate';
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await kvGet<string>(DEVICE_ID_KEY);
  if (typeof existing === 'string' && existing.length >= 16) return existing;
  const id = randomId(16);
  await kvSet(DEVICE_ID_KEY, id);
  return id;
}

let certPromise: Promise<RTCCertificate | null> | null = null;

/**
 * A persistent DTLS certificate gives this device a stable fingerprint, which
 * lets a peer recognise it on the next pairing (fingerprint pinning). Storing
 * RTCCertificate objects in IndexedDB is supported by Chromium and Firefox;
 * where it isn't, we fall back to a fresh certificate per session and every
 * pairing requires the verification code.
 */
export function getPersistentCertificate(): Promise<RTCCertificate | null> {
  if (!certPromise) certPromise = loadOrCreateCertificate();
  return certPromise;
}

async function loadOrCreateCertificate(): Promise<RTCCertificate | null> {
  if (typeof RTCPeerConnection === 'undefined' || !RTCPeerConnection.generateCertificate) {
    return null;
  }
  try {
    const stored = await kvGet<RTCCertificate>(CERT_KEY);
    if (
      stored &&
      typeof stored.expires === 'number' &&
      stored.expires - Date.now() > RENEW_BEFORE_MS
    ) {
      return stored;
    }
  } catch {
    // Fall through and generate a new certificate.
  }
  try {
    const keygen = {
      name: 'ECDSA',
      namedCurve: 'P-256',
      expires: 365 * 24 * 60 * 60 * 1000,
    } as AlgorithmIdentifier;
    const cert = await RTCPeerConnection.generateCertificate(keygen);
    try {
      await kvSet(CERT_KEY, cert);
    } catch {
      // Not cloneable in this browser: use it for this session only.
    }
    return cert;
  } catch {
    return null;
  }
}
