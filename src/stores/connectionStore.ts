import { create } from 'zustand';
import type { PeerPhase, RemoteDeviceInfo } from '@/services/webrtc/peerConnection';

/** Serializable view of a PeerSession for the UI. */
export interface PeerView {
  id: string;
  role: 'offerer' | 'answerer';
  phase: PeerPhase;
  remote: RemoteDeviceInfo | null;
  verificationCode: string | null;
  localConfirmed: boolean;
  remoteConfirmed: boolean;
  recognised: boolean;
  failureReason: string | null;
  connectedAt: number | null;
  expiresAt: number;
  createdAt: number;
}

interface ConnectionState {
  peers: Record<string, PeerView>;
  upsert: (view: PeerView) => void;
  remove: (id: string) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  peers: {},
  upsert: (view) => set((s) => ({ peers: { ...s.peers, [view.id]: view } })),
  remove: (id) =>
    set((s) => {
      const peers = { ...s.peers };
      delete peers[id];
      return { peers };
    }),
}));

export const isReadyPhase = (phase: PeerPhase) => phase === 'connected' || phase === 'unstable';

export function selectReadyPeers(state: ConnectionState): PeerView[] {
  return Object.values(state.peers)
    .filter((p) => isReadyPhase(p.phase))
    .sort((a, b) => (b.connectedAt ?? 0) - (a.connectedAt ?? 0));
}
