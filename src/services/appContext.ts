import { useSettingsStore } from '@/stores/settingsStore';
import { detectPlatform } from '@/utils/device';
import { getOrCreateDeviceId, getPersistentCertificate } from './storage/identityRepository';
import type { LocalDeviceInfo, PeerOptions } from './webrtc/peerConnection';

let deviceId: string | null = null;
let certificate: RTCCertificate | null = null;

export async function initIdentity() {
  deviceId = await getOrCreateDeviceId();
  certificate = await getPersistentCertificate();
}

export function localDeviceInfo(): LocalDeviceInfo {
  if (!deviceId) throw new Error('Identity not initialised');
  const info = detectPlatform();
  return {
    deviceId,
    name: useSettingsStore.getState().settings.deviceName,
    kind: info.kind,
    platform: info.platform,
  };
}

export function peerOptions(): PeerOptions {
  return {
    local: localDeviceInfo(),
    stunUrl: useSettingsStore.getState().settings.stunUrl,
    certificate,
  };
}

export function hasPersistentCertificate() {
  return certificate != null;
}
