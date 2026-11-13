import type { DeviceKind } from '@/types';

export interface PlatformInfo {
  kind: DeviceKind;
  /** Human platform label, e.g. "iPad", "Android", "Windows". */
  platform: string;
  browser: string;
  isIOS: boolean;
  isAndroid: boolean;
  isSafari: boolean;
  isStandalone: boolean;
}

export function detectPlatform(nav: Navigator = navigator): PlatformInfo {
  const ua = nav.userAgent || '';
  const maxTouch = nav.maxTouchPoints || 0;
  // iPadOS 13+ reports a desktop Safari UA; touch points give it away.
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1);
  const isIPhone = /iPhone|iPod/.test(ua);
  const isIOS = isIPad || isIPhone;
  const isAndroid = /Android/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|Chromium|Edg|FxiOS|OPR/.test(ua);

  let platform = 'Device';
  if (isIPad) platform = 'iPad';
  else if (isIPhone) platform = 'iPhone';
  else if (isAndroid) platform = 'Android';
  else if (/Windows/.test(ua)) platform = 'Windows';
  else if (/Macintosh|Mac OS X/.test(ua)) platform = 'Mac';
  else if (/CrOS/.test(ua)) platform = 'ChromeOS';
  else if (/Linux/.test(ua)) platform = 'Linux';

  let kind: DeviceKind = 'desktop';
  if (isIPad || (isAndroid && !/Mobile/.test(ua))) kind = 'tablet';
  else if (isIPhone || isAndroid) kind = 'phone';

  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/Chrome|CriOS/.test(ua)) browser = 'Chrome';
  else if (isSafari) browser = 'Safari';

  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (nav as Navigator & { standalone?: boolean }).standalone === true);

  return { kind, platform, browser, isIOS, isAndroid, isSafari, isStandalone };
}

export function defaultDeviceName(info: PlatformInfo = detectPlatform()): string {
  if (info.platform === 'Device') return 'My Device';
  return `My ${info.platform}`;
}

export interface CapabilityReport {
  secureContext: boolean;
  webrtc: boolean;
  camera: boolean;
  barcodeDetector: boolean;
  opfs: boolean;
  compression: boolean;
  clipboardWrite: boolean;
  clipboardRead: boolean;
  share: boolean;
  wakeLock: boolean;
  serviceWorker: boolean;
}

export function detectCapabilities(): CapabilityReport {
  const nav = navigator as Navigator & { wakeLock?: unknown };
  return {
    secureContext: window.isSecureContext,
    webrtc: typeof RTCPeerConnection !== 'undefined',
    camera: !!nav.mediaDevices?.getUserMedia,
    barcodeDetector: 'BarcodeDetector' in window,
    opfs: !!nav.storage?.getDirectory,
    compression: typeof CompressionStream !== 'undefined',
    clipboardWrite: !!nav.clipboard?.writeText,
    clipboardRead: !!nav.clipboard?.readText,
    share: !!nav.share,
    wakeLock: !!nav.wakeLock,
    serviceWorker: 'serviceWorker' in nav,
  };
}
