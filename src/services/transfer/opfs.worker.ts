/// <reference lib="webworker" />
/**
 * Writes incoming file data to the Origin Private File System with a
 * synchronous access handle (worker-only API) and hashes it on the way in.
 * Keeps received data on disk instead of in memory, which is what makes
 * large transfers practical on iPad Safari and Android Chrome.
 */
import { sha256 } from '@noble/hashes/sha2.js';

declare const self: DedicatedWorkerGlobalScope;

interface SyncHandle {
  read(buffer: ArrayBufferView, options?: { at: number }): number;
  write(buffer: ArrayBufferView, options?: { at: number }): number;
  truncate(size: number): void | Promise<void>;
  getSize(): number | Promise<number>;
  flush(): void | Promise<void>;
  close(): void | Promise<void>;
}

interface OpenFile {
  handle: SyncHandle;
  hasher: ReturnType<typeof sha256.create>;
  pos: number;
  failed: boolean;
}

export type WorkerRequest =
  | { op: 'probe'; rid: number }
  | { op: 'open'; rid: number; name: string; offset: number }
  | { op: 'write'; name: string; data: ArrayBuffer; byteOffset: number }
  | { op: 'close'; rid: number; name: string }
  | { op: 'abort'; rid: number; name: string; remove: boolean };

export type WorkerResponse =
  | { rid: number; ok: true; size?: number; sha256?: string }
  | { rid: number; ok: false; error: string; quota?: boolean }
  | { op: 'written'; name: string; bytes: number }
  | { op: 'error'; name: string; error: string; quota: boolean };

const DIR = 'fileshare-incoming';
const files = new Map<string, OpenFile>();

async function dir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

async function openHandle(name: string): Promise<SyncHandle> {
  const fh = await (await dir()).getFileHandle(name, { create: true });
  const create = (fh as unknown as { createSyncAccessHandle?: () => Promise<SyncHandle> })
    .createSyncAccessHandle;
  if (!create) throw new Error('Sync access handles are not supported');
  return create.call(fh);
}

function toHex(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

const isQuota = (err: unknown) => (err as DOMException)?.name === 'QuotaExceededError';

async function handle(msg: WorkerRequest): Promise<void> {
  switch (msg.op) {
    case 'probe': {
      const name = `.probe-${Math.random().toString(36).slice(2)}`;
      const h = await openHandle(name);
      h.write(new Uint8Array([1, 2, 3]), { at: 0 });
      await h.flush();
      await h.close();
      await (await dir()).removeEntry(name);
      self.postMessage({ rid: msg.rid, ok: true } satisfies WorkerResponse);
      return;
    }
    case 'open': {
      const existing = files.get(msg.name);
      if (existing) {
        await existing.handle.close();
        files.delete(msg.name);
      }
      const h = await openHandle(msg.name);
      const size = await h.getSize();
      const start = Math.min(msg.offset, size);
      await h.truncate(start);
      // Rebuild hash state for the bytes we keep.
      const hasher = sha256.create();
      const buf = new Uint8Array(1024 * 1024);
      for (let at = 0; at < start;) {
        const n = h.read(buf.subarray(0, Math.min(buf.length, start - at)), { at });
        if (n <= 0) break;
        hasher.update(buf.subarray(0, n));
        at += n;
      }
      files.set(msg.name, { handle: h, hasher, pos: start, failed: false });
      self.postMessage({ rid: msg.rid, ok: true, size: start } satisfies WorkerResponse);
      return;
    }
    case 'write': {
      const f = files.get(msg.name);
      if (!f || f.failed) return;
      const view = new Uint8Array(msg.data, msg.byteOffset);
      try {
        let written = 0;
        while (written < view.length) {
          const n = f.handle.write(view.subarray(written), { at: f.pos + written });
          if (n <= 0) throw new DOMException('Write failed', 'QuotaExceededError');
          written += n;
        }
        f.hasher.update(view);
        f.pos += view.length;
        self.postMessage({ op: 'written', name: msg.name, bytes: f.pos } satisfies WorkerResponse);
      } catch (err) {
        f.failed = true;
        self.postMessage({
          op: 'error',
          name: msg.name,
          error: (err as Error).message,
          quota: isQuota(err),
        } satisfies WorkerResponse);
      }
      return;
    }
    case 'close': {
      const f = files.get(msg.name);
      if (!f) throw new Error('File is not open');
      files.delete(msg.name);
      await f.handle.flush();
      await f.handle.close();
      if (f.failed) throw new Error('Writing failed');
      self.postMessage({
        rid: msg.rid,
        ok: true,
        size: f.pos,
        sha256: toHex(f.hasher.digest()),
      } satisfies WorkerResponse);
      return;
    }
    case 'abort': {
      const f = files.get(msg.name);
      files.delete(msg.name);
      try {
        await f?.handle.close();
      } catch {
        // ignore
      }
      if (msg.remove) {
        try {
          await (await dir()).removeEntry(msg.name);
        } catch {
          // already gone
        }
      }
      self.postMessage({ rid: msg.rid, ok: true } satisfies WorkerResponse);
      return;
    }
  }
}

// Process messages strictly in order: writes must not overtake opens/closes.
let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  queue = queue.then(() =>
    handle(msg).catch((err) => {
      if ('rid' in msg) {
        self.postMessage({
          rid: msg.rid,
          ok: false,
          error: (err as Error).message,
          quota: isQuota(err),
        } satisfies WorkerResponse);
      }
    }),
  );
};
