import { IncrementalSha256 } from './checksum';
import type { WorkerRequest, WorkerResponse } from './opfs.worker';

/**
 * Where incoming file bytes go while a transfer runs.
 *
 *  - OPFS (preferred): bytes are written to the browser's private, sandboxed
 *    file system from a worker. Memory use stays flat for any file size, the
 *    partial file survives a reload (enabling resume), and the finished file
 *    is a disk-backed File that can be saved or shared.
 *  - Memory (fallback): chunks are held in memory as Blob parts. Used when
 *    OPFS sync access handles are unavailable. Large files may exhaust memory,
 *    so the approval screen warns above MEMORY_RECEIVE_SOFT_LIMIT.
 *
 * Neither strategy writes outside the browser sandbox; files only leave it when
 * the user taps Save or Share.
 */
export interface ReceiveSink {
  readonly kind: 'opfs' | 'memory';
  readonly storageName: string;
  /** Bytes durably written so far. */
  readonly written: number;
  onProgress?: (bytes: number) => void;
  onError?: (error: Error & { quota?: boolean }) => void;
  /** Prepares the sink, keeping the first `offset` bytes. Returns the actual start offset. */
  open(offset: number): Promise<number>;
  /** Appends payload bytes (buffer + byteOffset avoids a copy). Ordered. */
  write(buffer: ArrayBuffer, byteOffset: number): void;
  finalize(): Promise<{ sha256: string; size: number }>;
  getFile(): Promise<File>;
  /** Releases resources but keeps data received so far (for resume). */
  suspend(): Promise<void>;
  /** Deletes everything received for this file. */
  discard(): Promise<void>;
}

export const OPFS_DIR = 'fileshare-incoming';

// ---- OPFS worker client ---------------------------------------------------

type Pending = { resolve: (r: WorkerResponse) => void };
let worker: Worker | null = null;
let rid = 0;
const pending = new Map<number, Pending>();
const sinksByName = new Map<string, OpfsSink>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if ('rid' in msg) {
        pending.get(msg.rid)?.resolve(msg);
        pending.delete(msg.rid);
      } else if (msg.op === 'written') {
        sinksByName.get(msg.name)?.handleWritten(msg.bytes);
      } else if (msg.op === 'error') {
        sinksByName.get(msg.name)?.handleError(msg.error, msg.quota);
      }
    };
  }
  return worker;
}

type RpcRequest = Extract<WorkerRequest, { rid: number }>;
type WithoutRid<T> = T extends unknown ? Omit<T, 'rid'> : never;

function call(req: WithoutRid<RpcRequest>): Promise<WorkerResponse> {
  const id = ++rid;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    getWorker().postMessage({ ...req, rid: id });
  });
}

let opfsSupport: Promise<boolean> | null = null;

/** Probes OPFS sync access handle support once (needs a worker round-trip). */
export function opfsSupported(): Promise<boolean> {
  if (!opfsSupport) {
    opfsSupport = (async () => {
      if (typeof Worker === 'undefined' || !navigator.storage?.getDirectory) return false;
      try {
        const res = await Promise.race([
          call({ op: 'probe' }),
          new Promise<WorkerResponse>((r) =>
            setTimeout(() => r({ rid: -1, ok: false, error: 'timeout' }), 4000),
          ),
        ]);
        return 'ok' in res && res.ok;
      } catch {
        return false;
      }
    })();
  }
  return opfsSupport;
}

class OpfsSink implements ReceiveSink {
  readonly kind = 'opfs' as const;
  written = 0;
  onProgress?: (bytes: number) => void;
  onError?: (error: Error & { quota?: boolean }) => void;
  private finalized = false;
  private readonly fileName: string;
  private readonly mime: string;
  private readonly lastModified: number;
  readonly storageName: string;

  constructor(storageName: string, fileName: string, mime: string, lastModified: number) {
    this.storageName = storageName;
    this.fileName = fileName;
    this.mime = mime;
    this.lastModified = lastModified;
  }

  async open(offset: number) {
    sinksByName.set(this.storageName, this);
    const res = await call({ op: 'open', name: this.storageName, offset });
    if (!('ok' in res) || !res.ok)
      throw new Error('Couldn’t prepare storage for the incoming file.');
    this.written = res.size ?? 0;
    return this.written;
  }

  write(buffer: ArrayBuffer, byteOffset: number) {
    getWorker().postMessage(
      { op: 'write', name: this.storageName, data: buffer, byteOffset } satisfies WorkerRequest,
      [buffer],
    );
  }

  handleWritten(bytes: number) {
    this.written = bytes;
    this.onProgress?.(bytes);
  }

  handleError(message: string, quota: boolean) {
    const err = Object.assign(new Error(message), { quota });
    this.onError?.(err);
  }

  async finalize() {
    const res = await call({ op: 'close', name: this.storageName });
    sinksByName.delete(this.storageName);
    if (!('ok' in res) || !res.ok || !res.sha256) {
      throw new Error('error' in res ? res.error : 'Couldn’t finish writing the file.');
    }
    this.finalized = true;
    return { sha256: res.sha256, size: res.size ?? 0 };
  }

  async getFile(): Promise<File> {
    if (!this.finalized) throw new Error('File is not complete');
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR);
    const raw = await (await dir.getFileHandle(this.storageName)).getFile();
    return new File([raw], this.fileName, { type: this.mime, lastModified: this.lastModified });
  }

  async suspend() {
    sinksByName.delete(this.storageName);
    await call({ op: 'abort', name: this.storageName, remove: false });
  }

  async discard() {
    sinksByName.delete(this.storageName);
    await call({ op: 'abort', name: this.storageName, remove: true });
  }
}

class MemorySink implements ReceiveSink {
  readonly kind = 'memory' as const;
  written = 0;
  onProgress?: (bytes: number) => void;
  onError?: (error: Error & { quota?: boolean }) => void;
  private parts: Uint8Array[] = [];
  private hasher = new IncrementalSha256();
  private file: File | null = null;
  readonly storageName: string;
  private readonly fileName: string;
  private readonly mime: string;
  private readonly lastModified: number;
  private progressTimer = 0;

  constructor(storageName: string, fileName: string, mime: string, lastModified: number) {
    this.storageName = storageName;
    this.fileName = fileName;
    this.mime = mime;
    this.lastModified = lastModified;
  }

  async open(offset: number) {
    // Keep whole chunks up to the requested offset.
    const keep: Uint8Array[] = [];
    let kept = 0;
    for (const p of this.parts) {
      if (kept + p.length > offset) break;
      keep.push(p);
      kept += p.length;
    }
    this.parts = keep;
    this.hasher = new IncrementalSha256();
    for (const p of keep) this.hasher.update(p);
    this.written = kept;
    this.file = null;
    return kept;
  }

  write(buffer: ArrayBuffer, byteOffset: number) {
    const data = new Uint8Array(buffer, byteOffset);
    this.parts.push(data);
    this.hasher.update(data);
    this.written += data.length;
    // Report asynchronously like the worker does, so callers see one code path.
    if (!this.progressTimer) {
      this.progressTimer = window.setTimeout(() => {
        this.progressTimer = 0;
        this.onProgress?.(this.written);
      }, 0);
    }
  }

  async finalize() {
    window.clearTimeout(this.progressTimer);
    this.progressTimer = 0;
    this.onProgress?.(this.written);
    this.file = new File(this.parts as BlobPart[], this.fileName, {
      type: this.mime,
      lastModified: this.lastModified,
    });
    // The File now owns the data; drop our references to avoid holding two copies.
    this.parts = [];
    return { sha256: this.hasher.digestHex(), size: this.file.size };
  }

  async getFile() {
    if (!this.file) throw new Error('File is not complete');
    return this.file;
  }

  async suspend() {
    window.clearTimeout(this.progressTimer);
    this.progressTimer = 0;
  }

  async discard() {
    this.parts = [];
    this.file = null;
  }
}

export async function createSink(
  preferOpfs: boolean,
  storageName: string,
  fileName: string,
  mime: string,
  lastModified: number,
): Promise<ReceiveSink> {
  if (preferOpfs && (await opfsSupported()))
    return new OpfsSink(storageName, fileName, mime, lastModified);
  return new MemorySink(storageName, fileName, mime, lastModified);
}

export function storageNameFor(transferId: string, fileId: string) {
  return `${transferId}_${fileId}`;
}

/** Size of a partial file left in OPFS (e.g. after a reload), or 0. */
export async function opfsPartialSize(storageName: string): Promise<number> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR);
    return (await (await dir.getFileHandle(storageName)).getFile()).size;
  } catch {
    return 0;
  }
}

/** Opens a completed OPFS file left from an earlier session (e.g. received but not yet saved). */
export async function opfsFile(
  storageName: string,
  fileName: string,
  mime: string,
): Promise<File | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR);
    const raw = await (await dir.getFileHandle(storageName)).getFile();
    return new File([raw], fileName, { type: mime, lastModified: raw.lastModified });
  } catch {
    return null;
  }
}

export async function removeOpfsFile(storageName: string) {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR);
    await dir.removeEntry(storageName);
  } catch {
    // already gone
  }
}

/** Removes stored incoming files, except those still needed. Returns bytes freed. */
export async function cleanupIncoming(keep: Set<string>, maxAgeMs = 0): Promise<number> {
  let freed = 0;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
    const now = Date.now();
    const iter = (
      dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
    ).entries();
    const names: string[] = [];
    for await (const [name, handle] of iter) {
      if (handle.kind !== 'file' || keep.has(name)) continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      if (now - file.lastModified >= maxAgeMs) {
        freed += file.size;
        names.push(name);
      }
    }
    for (const name of names) await dir.removeEntry(name).catch(() => {});
  } catch {
    // OPFS unavailable
  }
  return freed;
}

export async function storageEstimate(): Promise<{
  usage: number;
  quota: number;
  available: number;
} | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || !est.quota) return null;
    const usage = est.usage ?? 0;
    return { usage, quota: est.quota, available: Math.max(0, est.quota - usage) };
  } catch {
    return null;
  }
}
