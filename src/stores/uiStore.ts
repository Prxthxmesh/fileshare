import { create } from 'zustand';
import type { IncomingFileMeta } from '@/services/transfer/fileMetadata';

export type ToastTone = 'neutral' | 'success' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

export interface ApprovalRequest {
  transferId: string;
  peerId: string;
  peerName: string;
  files: IncomingFileMeta[];
  totalSize: number;
  resume: boolean;
  /** Bytes already received when resuming. */
  resumeBytes: number;
  storage: 'opfs' | 'memory';
  availableBytes: number | null;
  warning?: string;
  blocked?: string;
}

export interface IncomingText {
  id: string;
  peerName: string;
  content: string;
  at: number;
}

interface UiState {
  toasts: Toast[];
  approvals: ApprovalRequest[];
  texts: IncomingText[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  pushApproval: (a: ApprovalRequest) => void;
  removeApproval: (transferId: string) => void;
  pushText: (t: IncomingText) => void;
  removeText: (id: string) => void;
}

let toastId = 0;

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  approvals: [],
  texts: [],
  toast: (t) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  pushApproval: (a) =>
    set((s) => ({ approvals: [...s.approvals.filter((x) => x.transferId !== a.transferId), a] })),
  removeApproval: (transferId) =>
    set((s) => ({ approvals: s.approvals.filter((a) => a.transferId !== transferId) })),
  pushText: (t) => set((s) => ({ texts: [...s.texts, t] })),
  removeText: (id) => set((s) => ({ texts: s.texts.filter((t) => t.id !== id) })),
}));

export const toast = (t: Omit<Toast, 'id'>) => useUiStore.getState().toast(t);
