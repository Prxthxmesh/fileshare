import type { Settings } from '@/types';
import { defaultDeviceName } from '@/utils/device';
import { kvGet, kvSet } from './indexedDb';

const KEY = 'settings';

export function defaultSettings(): Settings {
  return {
    deviceName: defaultDeviceName(),
    theme: 'system',
    stunUrl: '',
    textHistoryEnabled: false,
    confirmCancel: true,
    keepAwake: true,
  };
}

export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Settings>;
  return {
    deviceName:
      typeof r.deviceName === 'string' && r.deviceName.trim()
        ? r.deviceName.trim().slice(0, 40)
        : base.deviceName,
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'system' ? r.theme : base.theme,
    stunUrl: typeof r.stunUrl === 'string' ? r.stunUrl.trim() : base.stunUrl,
    textHistoryEnabled: r.textHistoryEnabled === true,
    confirmCancel: r.confirmCancel !== false,
    keepAwake: r.keepAwake !== false,
  };
}

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await kvGet<Settings>(KEY));
}

export async function saveSettings(settings: Settings): Promise<void> {
  await kvSet(KEY, normalizeSettings(settings));
}

/** Accepts stun:/stuns: URLs only. TURN is intentionally not supported: FileShare never relays files. */
export function validateStunUrl(url: string): string | null {
  const value = url.trim();
  if (!value) return null;
  if (!/^stuns?:[A-Za-z0-9.-]+(:\d{1,5})?$/.test(value)) {
    return 'Enter a STUN address such as stun:stun.l.google.com:19302.';
  }
  return null;
}
