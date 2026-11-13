import { ICE_GATHER_TIMEOUT_MS, ICE_GATHER_TIMEOUT_WITH_STUN_MS } from '@/constants';

/**
 * ICE configuration.
 *
 * By default FileShare uses no ICE servers at all: on a shared Wi-Fi network,
 * host candidates are enough, and no request ever leaves the local network.
 * A STUN server can be configured in Settings; it needs internet access and
 * only helps discover public addresses — it never carries file data.
 * TURN (relay) servers are deliberately not supported.
 */
export function buildRtcConfiguration(
  stunUrl: string,
  certificate: RTCCertificate | null,
): RTCConfiguration {
  return {
    iceServers: stunUrl ? [{ urls: stunUrl }] : [],
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    ...(certificate ? { certificates: [certificate] } : {}),
  };
}

export function gatherTimeout(stunUrl: string): number {
  return stunUrl ? ICE_GATHER_TIMEOUT_WITH_STUN_MS : ICE_GATHER_TIMEOUT_MS;
}

/**
 * Waits for ICE gathering to finish. Because QR signaling can't trickle
 * candidates, all candidates must be in the local description before it is
 * encoded. On timeout we continue with what has been gathered (and report it
 * in diagnostics) rather than waiting forever on an unreachable STUN server.
 */
export function waitForIceGathering(
  pc: RTCPeerConnection,
  timeoutMs: number,
): Promise<{ complete: boolean }> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve({ complete: true });
  return new Promise((resolve) => {
    const done = (complete: boolean) => {
      window.clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      pc.removeEventListener('icecandidate', onCandidate);
      resolve({ complete });
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done(true);
    };
    const onCandidate = (e: RTCPeerConnectionIceEvent) => {
      if (!e.candidate) done(true);
    };
    const timer = window.setTimeout(() => done(false), timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
    pc.addEventListener('icecandidate', onCandidate);
  });
}

/**
 * Browsers hide local IP addresses behind random ".local" mDNS names unless
 * the page currently has camera/microphone access. mDNS names resolve on most
 * home networks, but not all (some routers block multicast). When camera
 * permission is already granted, briefly holding a camera stream during ICE
 * gathering lets the browser include real host addresses, which makes direct
 * LAN connections more reliable. Never prompts: it only acts when permission
 * was already granted. Returns a release function.
 */
export async function exposeHostCandidatesIfPermitted(
  existing?: MediaStream | null,
): Promise<() => void> {
  if (existing?.active) return () => {};
  try {
    const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    if (status?.state !== 'granted' || !navigator.mediaDevices?.getUserMedia) return () => {};
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 64, height: 64 },
      audio: false,
    });
    return () => stream.getTracks().forEach((t) => t.stop());
  } catch {
    return () => {};
  }
}
