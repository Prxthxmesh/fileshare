import { useEffect } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';

/** Applies the appearance preference, following the system setting by default. */
export function useTheme() {
  const pref = useSettingsStore((s) => s.settings.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref === 'dark' || (pref === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#0e0f11' : '#f2f3f5');
      try {
        localStorage.setItem('fileshare.theme', pref);
      } catch {
        // per-viewer convenience only
      }
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
}
