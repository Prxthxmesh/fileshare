import { create } from 'zustand';
import type { TransferRecord } from '@/types';

export interface LiveProgress {
  /** Bytes transferred across all files (sent or received). */
  bytes: number;
  speed: number | null;
  etaMs: number | null;
  currentFileIndex: number;
  /** Per-file byte counts, keyed by fileId. */
  fileBytes: Record<string, number>;
  /** Who paused, when paused. */
  pausedBy?: 'local' | 'remote';
}

export interface LiveTransfer {
  record: TransferRecord;
  progress: LiveProgress;
  /** Peer session currently carrying this transfer, if any. */
  peerId: string | null;
  /** Sender side: files are still in memory, so the transfer can be resumed or retried. */
  canResume: boolean;
  canRetry: boolean;
}

export interface ReceivedFile {
  key: string;
  transferId: string;
  fileId: string;
  name: string;
  size: number;
  mime: string;
  from: string;
  receivedAt: number;
  storage: 'opfs' | 'memory';
  saved: boolean;
  getFile: () => Promise<File>;
}

interface TransferState {
  live: Record<string, LiveTransfer>;
  history: TransferRecord[];
  historyLoaded: boolean;
  received: ReceivedFile[];
  setLive: (t: LiveTransfer) => void;
  patchLive: (id: string, patch: Partial<LiveTransfer>) => void;
  removeLive: (id: string) => void;
  setHistory: (records: TransferRecord[]) => void;
  upsertHistory: (record: TransferRecord) => void;
  removeHistory: (ids?: string[]) => void;
  addReceived: (file: ReceivedFile) => void;
  markSaved: (key: string) => void;
  removeReceived: (key: string) => void;
}

export const useTransferStore = create<TransferState>((set) => ({
  live: {},
  history: [],
  historyLoaded: false,
  received: [],
  setLive: (t) => set((s) => ({ live: { ...s.live, [t.record.id]: t } })),
  patchLive: (id, patch) =>
    set((s) => (s.live[id] ? { live: { ...s.live, [id]: { ...s.live[id], ...patch } } } : s)),
  removeLive: (id) =>
    set((s) => {
      const live = { ...s.live };
      delete live[id];
      return { live };
    }),
  setHistory: (records) => set({ history: records, historyLoaded: true }),
  upsertHistory: (record) =>
    set((s) => {
      const idx = s.history.findIndex((r) => r.id === record.id);
      if (idx === -1) return { history: [record, ...s.history] };
      const history = s.history.slice();
      history[idx] = record;
      return { history };
    }),
  removeHistory: (ids) =>
    set((s) => ({ history: ids ? s.history.filter((r) => !ids.includes(r.id)) : [] })),
  addReceived: (file) =>
    set((s) => ({ received: [file, ...s.received.filter((r) => r.key !== file.key)] })),
  markSaved: (key) =>
    set((s) => ({ received: s.received.map((r) => (r.key === key ? { ...r, saved: true } : r)) })),
  removeReceived: (key) => set((s) => ({ received: s.received.filter((r) => r.key !== key) })),
}));

export const ACTIVE_STATUSES = new Set([
  'pending',
  'awaiting-approval',
  'active',
  'paused',
  'verifying',
]);
