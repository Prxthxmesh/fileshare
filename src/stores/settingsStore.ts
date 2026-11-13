import { create } from 'zustand';
import type { Settings } from '@/types';
import { defaultSettings, loadSettings, saveSettings } from '@/services/storage/settingsRepository';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings(),
  loaded: false,
  load: async () => {
    try {
      set({ settings: await loadSettings(), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  update: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await saveSettings(next);
  },
}));
