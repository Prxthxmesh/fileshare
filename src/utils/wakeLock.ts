import { useSettingsStore } from '@/stores/settingsStore';

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
}

/**
 * Keeps the screen on while transfers run (Screen Wake Lock API, where
 * supported). Browsers release the lock when the page is hidden, so it is
 * re-acquired when FileShare becomes visible again.
 */
class WakeLockController {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.wanted) void this.acquire();
      });
    }
  }

  get supported() {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  update(active: boolean) {
    this.wanted = active && useSettingsStore.getState().settings.keepAwake;
    if (this.wanted) void this.acquire();
    else void this.release();
  }

  private async acquire() {
    if (!this.supported || (this.sentinel && !this.sentinel.released)) return;
    try {
      const wl = (
        navigator as Navigator & {
          wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
        }
      ).wakeLock;
      this.sentinel = await wl.request('screen');
    } catch {
      // Denied (e.g. low battery mode) — transfers continue, the warning in the UI still applies.
    }
  }

  private async release() {
    const s = this.sentinel;
    this.sentinel = null;
    if (s && !s.released) await s.release().catch(() => {});
  }
}

export const wakeLock = new WakeLockController();
