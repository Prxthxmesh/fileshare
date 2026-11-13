import {
  ACK_INTERVAL_BYTES,
  BUFFER_HIGH_WATER,
  CHUNK_SIZE,
  LARGE_TRANSFER_WARNING_BYTES,
  MAX_TEXT_LENGTH,
  MEMORY_RECEIVE_SOFT_LIMIT,
  RECEIVER_WINDOW,
} from '@/constants';
import { useDeviceStore } from '@/stores/deviceStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransferStore, type LiveTransfer } from '@/stores/transferStore';
import { toast, useUiStore } from '@/stores/uiStore';
import type { FileStatus, TransferRecord, TransferStatus } from '@/types';
import { randomId } from '@/utils/encoding';
import { formatBytes, pluralize } from '@/utils/format';
import { SpeedMeter } from '@/utils/speedMeter';
import { wakeLock } from '@/utils/wakeLock';
import { getDevice, putDevice } from '../storage/deviceRepository';
import { addTextHistory, getTransfer, putTransfer } from '../storage/transferRepository';
import { waitForDrain } from '../webrtc/dataChannel';
import type { PeerSession } from '../webrtc/peerConnection';
import { peerManager, type PeerMessageHandler } from '../webrtc/peerManager';
import {
  decodeChunk,
  encodeChunk,
  ProtocolError,
  type ControlMessage,
} from '../webrtc/transferProtocol';
import { hashBlobPrefix, IncrementalSha256 } from './checksum';
import { alignOffset, readChunks } from './chunkManager';
import {
  describeOutgoingFiles,
  prepareIncomingFiles,
  type IncomingFileMeta,
  type OutgoingFile,
} from './fileMetadata';
import {
  createSink,
  opfsFile,
  opfsPartialSize,
  opfsSupported,
  storageEstimate,
  storageNameFor,
  type ReceiveSink,
} from './receiveStorage';

/** Thrown inside transfer loops to unwind when a transfer stops. */
class TransferStop extends Error {
  constructor(
    readonly status: Extract<TransferStatus, 'cancelled' | 'interrupted' | 'failed' | 'rejected'>,
    message: string,
  ) {
    super(message);
  }
}

interface FileState {
  status: FileStatus;
  /** send: bytes handed to the channel; receive: bytes received from the channel */
  sent: number;
  /** send: bytes the receiver confirmed as written; receive: bytes durably written */
  acked: number;
  sha256?: string;
  verified?: boolean;
  reason?: string;
}

abstract class BaseTransfer {
  status: TransferStatus = 'pending';
  failureReason?: string;
  readonly startedAt: number;
  endedAt?: number;
  activeMs = 0;
  activeSince = 0;
  pausedLocal = false;
  pausedRemote = false;
  meter = new SpeedMeter();
  state = new Map<string, FileState>();
  currentIndex = 0;
  private waiters = new Set<() => void>();
  peer: PeerSession | null;
  readonly deviceId: string;
  readonly peerName: string;
  lastPersist = 0;

  constructor(
    readonly id: string,
    public tag: number,
    peer: PeerSession,
    startedAt = Date.now(),
  ) {
    this.peer = peer;
    this.deviceId = peer.remote?.deviceId ?? 'unknown';
    this.peerName = peer.remote?.name ?? 'Unknown device';
    this.startedAt = startedAt;
  }

  /** Resolves on the next wake() or after `ms`. */
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  wake() {
    [...this.waiters].forEach((w) => w());
  }

  get isRunning() {
    return ['pending', 'awaiting-approval', 'active', 'paused', 'verifying'].includes(this.status);
  }

  setActive(active: boolean) {
    const now = performance.now();
    if (active && !this.activeSince) this.activeSince = now;
    if (!active && this.activeSince) {
      this.activeMs += now - this.activeSince;
      this.activeSince = 0;
    }
  }

  get durationMs() {
    return this.activeMs + (this.activeSince ? performance.now() - this.activeSince : 0);
  }

  abstract get totalBytes(): number;
  abstract get doneBytes(): number;
}

class OutgoingTransfer extends BaseTransfer {
  files: OutgoingFile[];
  pendingAccept?: {
    resolve: (m: Extract<ControlMessage, { t: 'accept' }>) => void;
    reject: (e: Error) => void;
  };
  pendingResult?: {
    fileId: string;
    resolve: (m: Extract<ControlMessage, { t: 'file-result' }>) => void;
    reject: (e: Error) => void;
  };
  stop?: TransferStop;

  constructor(id: string, tag: number, peer: PeerSession, files: OutgoingFile[]) {
    super(id, tag, peer);
    this.files = files;
    for (const f of files) this.state.set(f.wire.id, { status: 'queued', sent: 0, acked: 0 });
  }

  get totalBytes() {
    return this.files.reduce((s, f) => s + f.wire.size, 0);
  }

  get doneBytes() {
    let n = 0;
    for (const s of this.state.values()) n += s.sent;
    return n;
  }

  halt(stop: TransferStop) {
    this.stop ??= stop;
    this.pendingAccept?.reject(stop);
    this.pendingResult?.reject(stop);
    this.pendingAccept = undefined;
    this.pendingResult = undefined;
    this.wake();
  }

  assertAlive() {
    if (this.stop) throw this.stop;
    if (!this.peer?.isOpen)
      throw new TransferStop('interrupted', 'The connection was lost during the transfer.');
  }
}

class IncomingTransfer extends BaseTransfer {
  files: IncomingFileMeta[];
  sinks = new Map<string, ReceiveSink>();
  storage: 'opfs' | 'memory' = 'memory';
  chunkSize = CHUNK_SIZE;
  current: { fileId: string; index: number; expectedChunk: number } | null = null;
  chain: Promise<void> = Promise.resolve();
  lastAck = new Map<string, number>();

  constructor(
    id: string,
    tag: number,
    peer: PeerSession,
    files: IncomingFileMeta[],
    startedAt?: number,
  ) {
    super(id, tag, peer, startedAt);
    this.files = files;
    for (const f of files) this.state.set(f.id, { status: 'queued', sent: 0, acked: 0 });
  }

  get totalBytes() {
    return this.files.reduce((s, f) => s + f.size, 0);
  }

  get doneBytes() {
    let n = 0;
    for (const s of this.state.values()) n += s.sent;
    return n;
  }
}

type AnyTransfer = OutgoingTransfer | IncomingTransfer;

const isOutgoing = (t: AnyTransfer): t is OutgoingTransfer => t instanceof OutgoingTransfer;

class TransferManager implements PeerMessageHandler {
  private outgoing = new Map<string, OutgoingTransfer>();
  private incoming = new Map<string, IncomingTransfer>();
  private flushTimers = new Map<string, number>();
  private pendingTexts = new Map<string, { resolve: () => void; timer: number }>();

  constructor() {
    peerManager.register(this);
  }

  // ======================================================================
  // Public API (used by the UI)
  // ======================================================================

  /** Offers files to a connected, verified peer. Returns the transfer id. */
  sendFiles(peerId: string, files: File[]): string {
    const peer = this.requireReadyPeer(peerId);
    const t = new OutgoingTransfer(randomId(12), randomTag(), peer, describeOutgoingFiles(files));
    this.outgoing.set(t.id, t);
    void this.runOutgoing(t, false);
    return t.id;
  }

  /** Continues an interrupted outgoing transfer over a new connection to the same device. */
  resumeOutgoing(transferId: string, peerId: string) {
    const t = this.outgoing.get(transferId);
    if (!t) throw new Error('This transfer can no longer be resumed. Send the files again.');
    const peer = this.requireReadyPeer(peerId);
    if (peer.remote?.deviceId !== t.deviceId)
      throw new Error('Resume works only with the same device.');
    t.peer = peer;
    t.stop = undefined;
    t.pausedLocal = t.pausedRemote = false;
    t.failureReason = undefined;
    t.endedAt = undefined;
    for (const s of t.state.values()) {
      if (s.status !== 'verified') {
        s.status = 'queued';
        s.reason = undefined;
      }
    }
    void this.runOutgoing(t, true);
  }

  /** Sends the files that didn't make it as a brand-new transfer. */
  retryOutgoing(transferId: string, peerId: string): string {
    const t = this.outgoing.get(transferId);
    if (!t) throw new Error('The files are no longer available. Choose them again.');
    const files = t.files
      .filter((f) => t.state.get(f.wire.id)?.status !== 'verified')
      .map((f) => f.file);
    if (!files.length) throw new Error('All files were already delivered.');
    return this.sendFiles(peerId, files);
  }

  approve(transferId: string) {
    const t = this.incoming.get(transferId);
    useUiStore.getState().removeApproval(transferId);
    if (!t || t.status !== 'awaiting-approval' || !t.peer?.isOpen) {
      toast({
        tone: 'error',
        title: 'The transfer is no longer available',
        message: 'The other device may have cancelled or disconnected.',
      });
      return;
    }
    const offsets: Record<string, number> = {};
    const done: string[] = [];
    for (const f of t.files) {
      const s = t.state.get(f.id)!;
      if (s.status === 'verified') done.push(f.id);
      else offsets[f.id] = alignOffset(s.acked, f.size, t.chunkSize);
    }
    t.status = 'active';
    t.peer.sendControl({ t: 'accept', transferId: t.id, offsets, done });
    t.meter.start(t.doneBytes);
    t.setActive(true);
    this.publish(t, true);
    if (done.length === t.files.length) void this.finishIncoming(t);
  }

  decline(transferId: string) {
    const t = this.incoming.get(transferId);
    useUiStore.getState().removeApproval(transferId);
    if (!t) return;
    t.peer?.sendControl({ t: 'reject', transferId, reason: 'declined' });
    void this.endIncoming(t, 'rejected', 'You declined this transfer.', true);
  }

  cancel(transferId: string) {
    const out = this.outgoing.get(transferId);
    if (out?.isRunning) {
      out.peer?.sendControl({ t: 'cancel', transferId });
      out.halt(new TransferStop('cancelled', 'You cancelled the transfer.'));
      if (out.status === 'pending' || out.status === 'awaiting-approval') {
        void this.endOutgoing(out, 'cancelled', 'You cancelled the transfer.');
      }
      return;
    }
    const inc = this.incoming.get(transferId);
    if (inc?.isRunning) {
      inc.peer?.sendControl({ t: 'cancel', transferId });
      useUiStore.getState().removeApproval(transferId);
      void this.endIncoming(inc, 'cancelled', 'You cancelled the transfer.', true);
    }
  }

  pause(transferId: string) {
    const t = this.outgoing.get(transferId) ?? this.incoming.get(transferId);
    if (!t || t.status !== 'active') return;
    t.pausedLocal = true;
    t.peer?.sendControl({ t: 'pause', transferId });
    this.applyPauseState(t);
  }

  resume(transferId: string) {
    const t = this.outgoing.get(transferId) ?? this.incoming.get(transferId);
    if (!t || !t.pausedLocal) return;
    t.pausedLocal = false;
    t.peer?.sendControl({ t: 'resume', transferId });
    this.applyPauseState(t);
  }

  /** Sends text over the DataChannel. Resolves when the other device confirms receipt. */
  async sendText(peerId: string, content: string): Promise<'delivered' | 'unconfirmed'> {
    if (!content.trim()) throw new Error('Enter some text first.');
    if (content.length > MAX_TEXT_LENGTH) {
      throw new Error(
        `Text is too long. The limit is ${MAX_TEXT_LENGTH.toLocaleString()} characters.`,
      );
    }
    const peer = this.requireReadyPeer(peerId);
    const id = randomId(12);
    const sent = peer.sendControl({ t: 'text', id, content });
    if (!sent) throw new Error('The connection closed before the text could be sent.');
    const delivered = await new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => {
        this.pendingTexts.delete(id);
        resolve(false);
      }, 15_000);
      this.pendingTexts.set(id, { resolve: () => resolve(true), timer });
    });
    await this.recordText(
      'send',
      peer.remote?.name ?? 'Unknown device',
      peer.remote?.deviceId ?? 'unknown',
      id,
      content,
      delivered,
    );
    return delivered ? 'delivered' : 'unconfirmed';
  }

  hasRunningTransfers(peerId?: string) {
    return [...this.outgoing.values(), ...this.incoming.values()].some(
      (t) => t.isRunning && (!peerId || t.peer?.id === peerId),
    );
  }

  // ======================================================================
  // Peer events
  // ======================================================================

  onControl(peer: PeerSession, msg: ControlMessage) {
    switch (msg.t) {
      case 'offer':
        void this.handleOffer(peer, msg);
        return;
      case 'accept': {
        const t = this.ownOutgoing(peer, msg.transferId);
        t?.pendingAccept?.resolve(msg);
        return;
      }
      case 'reject': {
        const t = this.ownOutgoing(peer, msg.transferId);
        if (!t) return;
        const reasons: Record<string, string> = {
          declined: `${t.peerName} declined the transfer.`,
          busy: `${t.peerName} is busy with another transfer.`,
          'insufficient-storage': `${t.peerName} doesn’t have enough free storage.`,
          unsupported: `${t.peerName} can’t receive these files.`,
          invalid: `${t.peerName} rejected the transfer details.`,
        };
        t.halt(new TransferStop('rejected', reasons[msg.reason] ?? reasons.declined));
        return;
      }
      case 'ack': {
        const t = this.ownOutgoing(peer, msg.transferId);
        const s = t?.state.get(msg.fileId);
        if (t && s && msg.bytes >= s.acked && msg.bytes <= s.sent) {
          s.acked = msg.bytes;
          t.wake();
        }
        return;
      }
      case 'file-result': {
        const t = this.ownOutgoing(peer, msg.transferId);
        if (t?.pendingResult?.fileId === msg.fileId) t.pendingResult.resolve(msg);
        return;
      }
      case 'file-start':
      case 'file-end': {
        const t = this.ownIncoming(peer, msg.transferId);
        if (!t || (t.status !== 'active' && t.status !== 'paused')) return;
        this.enqueue(t, () =>
          msg.t === 'file-start' ? this.onFileStart(t, msg) : this.onFileEnd(t, msg),
        );
        return;
      }
      case 'pause':
      case 'resume': {
        const t = this.ownOutgoing(peer, msg.transferId) ?? this.ownIncoming(peer, msg.transferId);
        if (!t) return;
        t.pausedRemote = msg.t === 'pause';
        this.applyPauseState(t);
        return;
      }
      case 'cancel': {
        const reason = `${peer.remote?.name ?? 'The other device'} cancelled the transfer.`;
        const out = this.ownOutgoing(peer, msg.transferId);
        if (out?.isRunning) {
          out.halt(new TransferStop('cancelled', reason));
          if (out.status === 'awaiting-approval') void this.endOutgoing(out, 'cancelled', reason);
        }
        const inc = this.ownIncoming(peer, msg.transferId);
        if (inc?.isRunning) {
          useUiStore.getState().removeApproval(inc.id);
          void this.endIncoming(
            inc,
            'cancelled',
            msg.reason ? `${reason} ${msg.reason}` : reason,
            true,
          );
        }
        return;
      }
      case 'text':
        peer.sendControl({ t: 'text-ack', id: msg.id });
        useUiStore.getState().pushText({
          id: msg.id,
          peerName: peer.remote?.name ?? 'Unknown device',
          content: msg.content,
          at: Date.now(),
        });
        void this.recordText(
          'receive',
          peer.remote?.name ?? 'Unknown device',
          peer.remote?.deviceId ?? 'unknown',
          msg.id,
          msg.content,
          true,
        );
        return;
      case 'text-ack': {
        const p = this.pendingTexts.get(msg.id);
        if (p) {
          window.clearTimeout(p.timer);
          this.pendingTexts.delete(msg.id);
          p.resolve();
        }
        return;
      }
    }
  }

  onBinary(peer: PeerSession, buf: ArrayBuffer) {
    let header;
    try {
      header = decodeChunk(buf).header;
    } catch {
      return;
    }
    const t = [...this.incoming.values()].find(
      (x) =>
        x.peer === peer && x.tag === header.tag && (x.status === 'active' || x.status === 'paused'),
    );
    if (!t) return;
    // Chunks run through the same ordered queue as file-start/file-end.
    this.enqueue(t, () => this.onChunk(t, buf, header));
  }

  onPeerGone(peer: PeerSession) {
    const reason = peer.failureReason ?? 'The connection was lost.';
    for (const t of this.outgoing.values()) {
      if (t.peer === peer && t.isRunning) {
        if (t.status === 'pending' || t.status === 'awaiting-approval') {
          t.halt(new TransferStop('interrupted', `${t.peerName} disconnected before accepting.`));
        } else {
          t.halt(new TransferStop('interrupted', reason));
        }
      }
    }
    for (const t of this.incoming.values()) {
      if (t.peer === peer && t.isRunning) {
        useUiStore.getState().removeApproval(t.id);
        void this.endIncoming(t, 'interrupted', reason, false);
      }
    }
    for (const [id, p] of this.pendingTexts) {
      window.clearTimeout(p.timer);
      this.pendingTexts.delete(id);
    }
  }

  // ======================================================================
  // Sending
  // ======================================================================

  private async runOutgoing(t: OutgoingTransfer, resume: boolean) {
    const peer = t.peer!;
    try {
      t.status = 'awaiting-approval';
      this.publish(t, true);
      const accepted = new Promise<Extract<ControlMessage, { t: 'accept' }>>((resolve, reject) => {
        t.pendingAccept = { resolve, reject };
      });
      const offered = peer.sendControl({
        t: 'offer',
        transferId: t.id,
        tag: t.tag,
        files: t.files.map((f) => f.wire),
        totalSize: t.totalBytes,
        chunkSize: CHUNK_SIZE,
        resume,
      });
      if (!offered)
        throw new TransferStop(
          'interrupted',
          'The connection closed before the files could be offered.',
        );
      const decision = await accepted;
      t.pendingAccept = undefined;

      // Fold in what the receiver already has (resume).
      for (const f of t.files) {
        const s = t.state.get(f.wire.id)!;
        if (decision.done.includes(f.wire.id)) {
          Object.assign(s, {
            status: 'verified',
            sent: f.wire.size,
            acked: f.wire.size,
            verified: true,
          });
        } else if (s.status !== 'verified') {
          const offset = alignOffset(decision.offsets[f.wire.id] ?? 0, f.wire.size);
          Object.assign(s, { status: 'queued', sent: offset, acked: offset });
        }
      }

      t.status = 'active';
      t.meter.start(t.doneBytes);
      t.setActive(true);
      this.publish(t, true);
      wakeLock.update(this.hasRunningTransfers());

      for (let i = 0; i < t.files.length; i++) {
        const f = t.files[i];
        if (t.state.get(f.wire.id)!.status === 'verified') continue;
        t.currentIndex = i;
        await this.sendOneFile(t, i, f);
      }

      const failed = t.files.filter((f) => t.state.get(f.wire.id)!.status !== 'verified');
      if (failed.length) {
        await this.endOutgoing(
          t,
          'failed',
          `${pluralize(failed.length, 'file')} didn’t pass the integrity check. Tap Retry to send ${failed.length === 1 ? 'it' : 'them'} again.`,
        );
      } else {
        await this.endOutgoing(t, 'completed');
      }
    } catch (err) {
      if (err instanceof TransferStop) {
        await this.endOutgoing(t, err.status, err.message);
      } else {
        console.error('[FileShare] send failed', err);
        t.peer?.sendControl({ t: 'cancel', transferId: t.id, reason: 'The sender hit an error.' });
        await this.endOutgoing(
          t,
          'failed',
          readError(err, 'A file couldn’t be read. It may have been moved or deleted.'),
        );
      }
    }
  }

  private async sendOneFile(t: OutgoingTransfer, index: number, f: OutgoingFile) {
    const s = t.state.get(f.wire.id)!;
    const offset = s.sent;
    s.status = 'transferring';
    t.assertAlive();
    t.peer!.sendControl({ t: 'file-start', transferId: t.id, fileId: f.wire.id, offset });
    this.publish(t);

    const hasher = offset > 0 ? await hashBlobPrefix(f.file, offset) : new IncrementalSha256();
    for await (const chunk of readChunks(f.file, offset)) {
      await this.gate(t, s);
      t.peer!.sendBinary(
        encodeChunk({ tag: t.tag, fileIndex: index, chunkIndex: chunk.index }, chunk.data),
      );
      hasher.update(chunk.data);
      s.sent = chunk.offset + chunk.data.length;
      this.publish(t);
    }
    if (s.sent !== f.wire.size) {
      throw new TransferStop('failed', `“${f.wire.name}” changed size while it was being sent.`);
    }
    const sha256 = hasher.digestHex();
    s.sha256 = sha256;
    s.status = 'verifying';
    const result = new Promise<Extract<ControlMessage, { t: 'file-result' }>>((resolve, reject) => {
      t.pendingResult = { fileId: f.wire.id, resolve, reject };
    });
    t.assertAlive();
    t.peer!.sendControl({ t: 'file-end', transferId: t.id, fileId: f.wire.id, sha256 });
    this.publish(t);
    const res = await result;
    t.pendingResult = undefined;
    if (res.ok) {
      Object.assign(s, { status: 'verified', verified: true, acked: f.wire.size });
    } else {
      Object.assign(s, {
        status: 'failed',
        verified: false,
        reason: res.reason ?? 'Checksum mismatch',
      });
    }
    this.publish(t, true);
  }

  /** Blocks while paused, while the channel buffer is full, or while too much data is unconfirmed. */
  private async gate(t: OutgoingTransfer, s: FileState) {
    for (;;) {
      t.assertAlive();
      if (t.pausedLocal || t.pausedRemote) {
        await t.wait(1000);
        continue;
      }
      const ch = t.peer!.channel;
      if (ch.bufferedAmount > BUFFER_HIGH_WATER) {
        const drained = waitForDrain(ch).catch(() => undefined);
        await Promise.race([drained, t.wait(2000)]);
        continue;
      }
      if (s.sent - s.acked > RECEIVER_WINDOW) {
        await t.wait(1000);
        continue;
      }
      return;
    }
  }

  private async endOutgoing(t: OutgoingTransfer, status: TransferStatus, reason?: string) {
    if (!t.isRunning && t.endedAt) return;
    t.setActive(false);
    t.status = status;
    t.failureReason = status === 'completed' ? undefined : reason;
    t.endedAt = Date.now();
    for (const s of t.state.values()) {
      if (s.status === 'transferring' || s.status === 'verifying' || s.status === 'queued') {
        s.status =
          status === 'completed'
            ? 'verified'
            : status === 'cancelled'
              ? 'cancelled'
              : s.status === 'queued'
                ? 'queued'
                : 'failed';
      }
    }
    this.publish(t, true);
    wakeLock.update(this.hasRunningTransfers());
    this.notifyEnd(t);
    if (status === 'completed') void this.bumpDevice(t.deviceId);
  }

  // ======================================================================
  // Receiving
  // ======================================================================

  private async handleOffer(peer: PeerSession, msg: Extract<ControlMessage, { t: 'offer' }>) {
    const existing = this.incoming.get(msg.transferId);
    if (existing?.isRunning) return; // duplicate offer
    if (existing && existing.peer !== peer && existing.deviceId !== peer.remote?.deviceId) {
      peer.sendControl({ t: 'reject', transferId: msg.transferId, reason: 'invalid' });
      return;
    }

    const files = prepareIncomingFiles(msg.files);
    let t: IncomingTransfer;
    if (msg.resume && existing && existing.status === 'interrupted') {
      t = existing;
      t.peer = peer;
      t.tag = msg.tag;
      t.files = files;
    } else {
      t = new IncomingTransfer(msg.transferId, msg.tag, peer, files);
      if (msg.resume) await this.restorePartialFromDisk(t, peer);
    }
    t.chunkSize = msg.chunkSize;
    t.status = 'awaiting-approval';
    t.endedAt = undefined;
    t.failureReason = undefined;
    t.pausedLocal = t.pausedRemote = false;
    t.current = null;
    t.chain = Promise.resolve();
    this.incoming.set(t.id, t);

    t.storage = (await opfsSupported()) ? 'opfs' : 'memory';
    const resumeBytes = [...t.state.values()].reduce((s, f) => s + f.acked, 0);
    const remaining = t.totalBytes - resumeBytes;
    const estimate = await storageEstimate();
    let blocked: string | undefined;
    let warning: string | undefined;
    if (t.storage === 'opfs' && estimate && remaining > estimate.available * 0.95) {
      blocked = `Not enough storage. These files need ${formatBytes(remaining)}, and about ${formatBytes(estimate.available)} is available to FileShare.`;
    } else if (t.storage === 'memory' && remaining > MEMORY_RECEIVE_SOFT_LIMIT) {
      warning = `This browser keeps received files in memory. Files this large (${formatBytes(remaining)}) may fail on this device. Consider sending fewer files at a time.`;
    } else if (remaining > LARGE_TRANSFER_WARNING_BYTES) {
      warning = 'Keep FileShare open and your screen awake while transferring large files.';
    }

    this.publish(t, true);
    useUiStore.getState().pushApproval({
      transferId: t.id,
      peerId: peer.id,
      peerName: peer.remote?.name ?? 'Unknown device',
      files: t.files,
      totalSize: t.totalBytes,
      resume: msg.resume && resumeBytes > 0,
      resumeBytes,
      storage: t.storage,
      availableBytes: estimate?.available ?? null,
      warning,
      blocked,
    });
  }

  /** After a reload, rebuild resume state from the transfer record and partial files in OPFS. */
  private async restorePartialFromDisk(t: IncomingTransfer, peer: PeerSession) {
    const record = await getTransfer(t.id).catch(() => undefined);
    if (!record || record.direction !== 'receive' || record.peerDeviceId !== peer.remote?.deviceId)
      return;
    if (record.storage !== 'opfs' || !(await opfsSupported())) return;
    for (const f of t.files) {
      const r = record.files.find((x) => x.fileId === f.id);
      if (!r || r.size !== f.size) continue;
      const name = storageNameFor(t.id, f.id);
      const onDisk = await opfsPartialSize(name);
      const s = t.state.get(f.id)!;
      if (r.status === 'verified' && onDisk === f.size) {
        Object.assign(s, {
          status: 'verified',
          sent: f.size,
          acked: f.size,
          verified: true,
          sha256: r.sha256,
        });
      } else {
        // The bytes on disk are the source of truth (progress in the record is
        // only saved every few seconds). Whatever is kept is re-hashed and the
        // final SHA-256 covers the whole file, so damaged data can't pass.
        const keep = alignOffset(onDisk, f.size, CHUNK_SIZE);
        Object.assign(s, { status: 'queued', sent: keep, acked: keep });
      }
    }
  }

  private enqueue(t: IncomingTransfer, task: () => void | Promise<void>) {
    t.chain = t.chain.then(async () => {
      if (t.status !== 'active' && t.status !== 'paused') return;
      try {
        await task();
      } catch (err) {
        const message =
          err instanceof ProtocolError
            ? 'The other device sent data FileShare didn’t expect, so the transfer was stopped.'
            : readError(err, 'Saving the incoming file failed.');
        t.peer?.sendControl({
          t: 'cancel',
          transferId: t.id,
          reason: 'The receiver hit an error.',
        });
        await this.endIncoming(t, 'failed', message, true);
      }
    });
  }

  private async onFileStart(
    t: IncomingTransfer,
    msg: Extract<ControlMessage, { t: 'file-start' }>,
  ) {
    const index = t.files.findIndex((f) => f.id === msg.fileId);
    if (index < 0) throw new ProtocolError('Unknown file');
    if (t.current) throw new ProtocolError('File started before the previous one ended');
    const meta = t.files[index];
    const s = t.state.get(meta.id)!;
    if (s.status === 'verified') throw new ProtocolError('File already received');
    if (
      msg.offset > s.acked ||
      msg.offset > meta.size ||
      (msg.offset !== meta.size && msg.offset % t.chunkSize !== 0)
    ) {
      throw new ProtocolError('Unexpected offset');
    }
    let sink = t.sinks.get(meta.id);
    if (!sink) {
      sink = await createSink(
        t.storage === 'opfs',
        storageNameFor(t.id, meta.id),
        meta.name,
        meta.mime,
        meta.lastModified,
      );
      t.sinks.set(meta.id, sink);
    }
    sink.onProgress = (bytes) => {
      s.acked = bytes;
      const last = t.lastAck.get(meta.id) ?? 0;
      if (bytes - last >= ACK_INTERVAL_BYTES || bytes === meta.size) {
        t.lastAck.set(meta.id, bytes);
        t.peer?.sendControl({ t: 'ack', transferId: t.id, fileId: meta.id, bytes });
      }
      this.publish(t);
    };
    sink.onError = (err) => {
      const message = err.quota
        ? 'This device ran out of storage space while receiving.'
        : 'Saving the incoming file failed.';
      t.peer?.sendControl({ t: 'cancel', transferId: t.id, reason: message });
      void this.endIncoming(t, 'failed', message, true);
    };
    const start = await sink.open(msg.offset);
    if (start !== msg.offset)
      throw new Error('The partially received file is no longer available.');
    t.lastAck.set(meta.id, start);
    Object.assign(s, { status: 'transferring', sent: start, acked: start });
    t.current = { fileId: meta.id, index, expectedChunk: start / t.chunkSize };
    t.currentIndex = index;
    if (meta.size === 0)
      t.peer?.sendControl({ t: 'ack', transferId: t.id, fileId: meta.id, bytes: 0 });
    this.publish(t);
  }

  private onChunk(
    t: IncomingTransfer,
    buf: ArrayBuffer,
    header: { fileIndex: number; chunkIndex: number; length: number },
  ) {
    const cur = t.current;
    if (!cur || header.fileIndex !== cur.index || header.chunkIndex !== cur.expectedChunk) {
      throw new ProtocolError('Out-of-sequence chunk');
    }
    const meta = t.files[cur.index];
    const s = t.state.get(meta.id)!;
    if (header.length > t.chunkSize || s.sent + header.length > meta.size)
      throw new ProtocolError('Chunk exceeds file');
    if (header.length < t.chunkSize && s.sent + header.length !== meta.size)
      throw new ProtocolError('Short chunk');
    cur.expectedChunk++;
    s.sent += header.length;
    t.sinks.get(meta.id)!.write(buf, 16);
    this.publish(t);
  }

  private async onFileEnd(t: IncomingTransfer, msg: Extract<ControlMessage, { t: 'file-end' }>) {
    const cur = t.current;
    if (!cur || cur.fileId !== msg.fileId) throw new ProtocolError('Unexpected file end');
    const meta = t.files[cur.index];
    const s = t.state.get(meta.id)!;
    if (s.sent !== meta.size) throw new ProtocolError('File ended early');
    s.status = 'verifying';
    this.publish(t);
    const sink = t.sinks.get(meta.id)!;
    const result = await sink.finalize();
    t.current = null;
    const ok = result.size === meta.size && result.sha256 === msg.sha256;
    s.sha256 = result.sha256;
    if (ok) {
      Object.assign(s, { status: 'verified', verified: true, acked: meta.size });
      const from = t.peerName;
      useTransferStore.getState().addReceived({
        key: `${t.id}:${meta.id}`,
        transferId: t.id,
        fileId: meta.id,
        name: meta.name,
        size: meta.size,
        mime: meta.mime,
        from,
        receivedAt: Date.now(),
        storage: sink.kind,
        saved: false,
        getFile: () => sink.getFile(),
      });
    } else {
      Object.assign(s, {
        status: 'failed',
        verified: false,
        reason: 'The received data didn’t match the original (SHA-256 mismatch).',
      });
      await sink.discard();
      t.sinks.delete(meta.id);
    }
    t.peer?.sendControl({
      t: 'file-result',
      transferId: t.id,
      fileId: meta.id,
      ok,
      ...(ok ? {} : { reason: 'Checksum mismatch' }),
    });
    this.publish(t, true);
    if (t.files.every((f) => ['verified', 'failed'].includes(t.state.get(f.id)!.status))) {
      await this.finishIncoming(t);
    }
  }

  private async finishIncoming(t: IncomingTransfer) {
    const failed = t.files.filter((f) => t.state.get(f.id)!.status !== 'verified').length;
    if (failed) {
      await this.endIncoming(
        t,
        'failed',
        `${pluralize(failed, 'file')} didn’t pass the integrity check and ${failed === 1 ? 'was' : 'were'} discarded. Ask the sender to retry.`,
        false,
      );
    } else {
      await this.endIncoming(t, 'completed', undefined, false);
      void this.bumpDevice(t.deviceId);
    }
  }

  private async endIncoming(
    t: IncomingTransfer,
    status: TransferStatus,
    reason: string | undefined,
    discard: boolean,
  ) {
    if (!t.isRunning && t.endedAt) return;
    t.setActive(false);
    t.status = status;
    t.failureReason = reason;
    t.endedAt = Date.now();
    t.current = null;
    for (const [fileId, sink] of t.sinks) {
      const s = t.state.get(fileId)!;
      if (s.status === 'verified') continue;
      if (discard || status === 'cancelled' || status === 'rejected') {
        await sink.discard().catch(() => {});
        t.sinks.delete(fileId);
        s.acked = s.sent = 0;
      } else {
        // Keep partial data (on disk for OPFS) so a later resume can continue from it.
        s.acked = sink.written;
        await sink.suspend().catch(() => {});
      }
    }
    for (const s of t.state.values()) {
      if (s.status === 'transferring' || s.status === 'verifying')
        s.status = status === 'cancelled' ? 'cancelled' : 'failed';
      if (status === 'interrupted' && s.status === 'failed' && !s.reason) s.status = 'queued';
    }
    this.publish(t, true);
    wakeLock.update(this.hasRunningTransfers());
    this.notifyEnd(t);
  }

  // ======================================================================
  // Helpers
  // ======================================================================

  private applyPauseState(t: AnyTransfer) {
    const paused = t.pausedLocal || t.pausedRemote;
    if (t.status === 'active' && paused) {
      t.status = 'paused';
      t.setActive(false);
    } else if (t.status === 'paused' && !paused) {
      t.status = 'active';
      t.meter.start(t.doneBytes);
      t.setActive(true);
    }
    t.wake();
    this.publish(t, true);
  }

  private requireReadyPeer(peerId: string): PeerSession {
    const peer = peerManager.get(peerId);
    if (!peer?.isReady)
      throw new Error('That device is no longer connected. Pair again to continue.');
    return peer;
  }

  private ownOutgoing(peer: PeerSession, id: string) {
    const t = this.outgoing.get(id);
    return t && t.peer === peer ? t : undefined;
  }

  private ownIncoming(peer: PeerSession, id: string) {
    const t = this.incoming.get(id);
    return t && t.peer === peer ? t : undefined;
  }

  private notifyEnd(t: AnyTransfer) {
    const what = pluralize(t.files.length, 'file');
    if (t.status === 'completed') {
      toast({
        tone: 'success',
        title: isOutgoing(t)
          ? `Sent ${what} to ${t.peerName}`
          : `Received ${what} from ${t.peerName}`,
        message: 'Integrity verified (SHA-256).',
      });
    } else if (t.status === 'failed' || t.status === 'interrupted') {
      toast({
        tone: 'error',
        title: t.status === 'failed' ? 'Transfer failed' : 'Transfer interrupted',
        message: t.failureReason,
      });
    } else if (
      (t.status === 'cancelled' || t.status === 'rejected') &&
      t.failureReason &&
      !t.failureReason.startsWith('You')
    ) {
      toast({
        tone: 'neutral',
        title: t.status === 'rejected' ? 'Transfer declined' : 'Transfer cancelled',
        message: t.failureReason,
      });
    }
  }

  private toRecord(t: AnyTransfer): TransferRecord {
    const out = isOutgoing(t);
    const files = out
      ? t.files.map((f) => ({
          id: f.wire.id,
          name: f.wire.name,
          size: f.wire.size,
          mime: f.wire.mime,
          lastModified: f.wire.lastModified,
        }))
      : t.files.map((f) => ({
          id: f.id,
          name: f.name,
          size: f.size,
          mime: f.mime,
          lastModified: f.lastModified,
        }));
    return {
      id: t.id,
      direction: out ? 'send' : 'receive',
      kind: 'files',
      peerDeviceId: t.deviceId,
      peerName: t.peerName,
      status: t.status,
      files: files.map((f) => {
        const s = t.state.get(f.id)!;
        return {
          fileId: f.id,
          name: f.name,
          size: f.size,
          mime: f.mime,
          lastModified: f.lastModified,
          status: s.status,
          bytes: out ? s.acked : s.acked,
          sha256: s.sha256,
          checksumVerified: s.verified,
          failureReason: s.reason,
        };
      }),
      totalBytes: t.totalBytes,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      durationMs: Math.round(t.durationMs),
      failureReason: t.failureReason,
      storage: out ? undefined : (t as IncomingTransfer).storage,
      resumable: t.status === 'interrupted',
    };
  }

  /**
   * Pushes state to the UI store (throttled to ~5 updates/s per transfer) and
   * to IndexedDB (on status changes, otherwise every few seconds).
   */
  private publish(t: AnyTransfer, immediate = false) {
    const flush = () => {
      this.flushTimers.delete(t.id);
      const record = this.toRecord(t);
      const speed = t.status === 'active' ? t.meter.update(t.doneBytes) : null;
      const remaining = t.totalBytes - t.doneBytes;
      const fileBytes: Record<string, number> = {};
      for (const [id, s] of t.state) fileBytes[id] = s.sent;
      const live: LiveTransfer = {
        record,
        peerId: t.peer?.id ?? null,
        canResume: isOutgoing(t) && t.status === 'interrupted',
        canRetry:
          isOutgoing(t) && ['failed', 'cancelled', 'interrupted', 'rejected'].includes(t.status),
        progress: {
          bytes: t.doneBytes,
          speed,
          etaMs: t.status === 'active' ? t.meter.eta(remaining) : null,
          currentFileIndex: t.currentIndex,
          fileBytes,
          pausedBy: t.pausedLocal ? 'local' : t.pausedRemote ? 'remote' : undefined,
        },
      };
      const store = useTransferStore.getState();
      store.setLive(live);
      store.upsertHistory(record);
      const now = Date.now();
      if (immediate || now - t.lastPersist > 3000) {
        t.lastPersist = now;
        putTransfer(record).catch(() => {});
      }
    };
    if (immediate) {
      const timer = this.flushTimers.get(t.id);
      if (timer) window.clearTimeout(timer);
      flush();
    } else if (!this.flushTimers.has(t.id)) {
      this.flushTimers.set(t.id, window.setTimeout(flush, 200));
    }
  }

  private async recordText(
    direction: 'send' | 'receive',
    peerName: string,
    peerDeviceId: string,
    id: string,
    content: string,
    delivered: boolean,
  ) {
    const now = Date.now();
    const historyOn = useSettingsStore.getState().settings.textHistoryEnabled;
    const record: TransferRecord = {
      id,
      direction,
      kind: 'text',
      peerDeviceId,
      peerName,
      status: delivered ? 'completed' : 'failed',
      files: [],
      totalBytes: new TextEncoder().encode(content).length,
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      textLength: content.length,
      // Store the content itself only when the user opted in to text history.
      textPreview: historyOn ? content.slice(0, 200) : undefined,
      failureReason: delivered ? undefined : 'The other device didn’t confirm receipt.',
    };
    useTransferStore.getState().upsertHistory(record);
    await putTransfer(record).catch(() => {});
    if (historyOn)
      await addTextHistory({ id, direction, peerName, content, at: now }).catch(() => {});
  }

  private async bumpDevice(deviceId: string) {
    const d = await getDevice(deviceId).catch(() => undefined);
    if (!d) return;
    const next = { ...d, transferCount: d.transferCount + 1, lastTransferAt: Date.now() };
    await putDevice(next).catch(() => {});
    useDeviceStore.getState().upsert(next);
  }

  /** Re-offers received files left in OPFS by an earlier session so they can still be saved. */
  async restoreReceivedFiles(records: TransferRecord[]) {
    if (!(await opfsSupported())) return;
    for (const r of records) {
      if (r.direction !== 'receive' || r.storage !== 'opfs') continue;
      for (const f of r.files) {
        if (f.status !== 'verified') continue;
        const storageName = storageNameFor(r.id, f.fileId);
        const file = await opfsFile(storageName, f.name, f.mime);
        if (!file || file.size !== f.size) continue;
        useTransferStore.getState().addReceived({
          key: `${r.id}:${f.fileId}`,
          transferId: r.id,
          fileId: f.fileId,
          name: f.name,
          size: f.size,
          mime: f.mime,
          from: r.peerName,
          receivedAt: r.endedAt ?? r.startedAt,
          storage: 'opfs',
          saved: false,
          getFile: async () => file,
        });
      }
    }
  }
}

function randomTag() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0];
}

function readError(err: unknown, fallback: string) {
  if (
    err instanceof Error &&
    err.message &&
    err.message.length < 200 &&
    !/^[A-Z][a-zA-Z]*Error/.test(err.message)
  ) {
    return err.message;
  }
  return fallback;
}

export const transferManager = new TransferManager();
