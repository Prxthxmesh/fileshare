import { create } from 'zustand';

export const AVAILABLE_MS = 50_000;

interface LinkState {
  /** Quick connect is switched on and there is at least one linked device or pairing in progress. */
  active: boolean;
  /** Relays currently connected. */
  relays: number;
  /** Last time each linked device announced itself (deviceId → ms). */
  seen: Record<string, number>;
  connecting: Record<string, boolean>;
  set: (patch: Partial<Omit<LinkState, 'set' | 'markSeen' | 'setConnecting'>>) => void;
  markSeen: (deviceId: string) => void;
  setConnecting: (deviceId: string, value: boolean) => void;
}

export const useLinkStore = create<LinkState>((set) => ({
  active: false,
  relays: 0,
  seen: {},
  connecting: {},
  set: (patch) => set(patch),
  markSeen: (deviceId) => set((s) => ({ seen: { ...s.seen, [deviceId]: Date.now() } })),
  setConnecting: (deviceId, value) =>
    set((s) => ({ connecting: { ...s.connecting, [deviceId]: value } })),
}));

export function isAvailable(seen: number | undefined, now = Date.now()) {
  return !!seen && now - seen < AVAILABLE_MS;
}
