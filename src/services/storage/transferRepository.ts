import type { TextHistoryEntry, TransferRecord } from '@/types';
import { getDb } from './indexedDb';

const HISTORY_LIMIT = 500;

export async function listTransfers(limit = HISTORY_LIMIT): Promise<TransferRecord[]> {
  const db = await getDb();
  const out: TransferRecord[] = [];
  let cursor = await db.transaction('transfers').store.index('startedAt').openCursor(null, 'prev');
  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }
  return out;
}

export async function getTransfer(id: string): Promise<TransferRecord | undefined> {
  return (await getDb()).get('transfers', id);
}

export async function putTransfer(record: TransferRecord): Promise<void> {
  await (await getDb()).put('transfers', record);
}

export async function deleteTransfer(id: string): Promise<void> {
  await (await getDb()).delete('transfers', id);
}

export async function clearTransfers(peerDeviceId?: string): Promise<void> {
  const db = await getDb();
  if (!peerDeviceId) {
    await db.clear('transfers');
    return;
  }
  const tx = db.transaction('transfers', 'readwrite');
  let cursor = await tx.store.index('peerDeviceId').openCursor(peerDeviceId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

/**
 * Transfers that were still running when the app was last closed can't be
 * running now. Mark them as interrupted so history stays truthful.
 */
export async function markStaleTransfersInterrupted(): Promise<number> {
  const db = await getDb();
  const tx = db.transaction('transfers', 'readwrite');
  let count = 0;
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const r = cursor.value;
    if (['active', 'paused', 'verifying', 'pending', 'awaiting-approval'].includes(r.status)) {
      await cursor.update({
        ...r,
        status: 'interrupted',
        endedAt: r.endedAt ?? Date.now(),
        failureReason: r.failureReason ?? 'FileShare was closed or reloaded during the transfer.',
      });
      count++;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return count;
}

export async function listTextHistory(): Promise<TextHistoryEntry[]> {
  const db = await getDb();
  return (await db.getAllFromIndex('texts', 'at')).reverse();
}

export async function addTextHistory(entry: TextHistoryEntry): Promise<void> {
  await (await getDb()).put('texts', entry);
}

export async function clearTextHistory(): Promise<void> {
  await (await getDb()).clear('texts');
}
