import { create } from 'zustand';
import type { DeviceRecord } from '@/types';
import * as repo from '@/services/storage/deviceRepository';

interface DeviceState {
  devices: DeviceRecord[];
  loaded: boolean;
  load: () => Promise<void>;
  upsert: (device: DeviceRecord) => void;
  rename: (deviceId: string, name: string) => Promise<void>;
  revokeTrust: (deviceId: string) => Promise<void>;
  remove: (deviceId: string) => Promise<void>;
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  loaded: false,
  load: async () => {
    try {
      set({ devices: await repo.listDevices(), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  upsert: (device) =>
    set((s) => ({
      devices: [device, ...s.devices.filter((d) => d.deviceId !== device.deviceId)].sort(
        (a, b) => b.lastConnected - a.lastConnected,
      ),
    })),
  rename: async (deviceId, name) => {
    const updated = await repo.updateDevice(deviceId, {
      customName: name.trim().slice(0, 40) || undefined,
    });
    if (updated) get().upsert(updated);
  },
  revokeTrust: async (deviceId) => {
    const updated = await repo.updateDevice(deviceId, { trusted: false, fingerprint: undefined });
    if (updated) get().upsert(updated);
  },
  remove: async (deviceId) => {
    await repo.deleteDevice(deviceId);
    set((s) => ({ devices: s.devices.filter((d) => d.deviceId !== deviceId) }));
  },
}));
