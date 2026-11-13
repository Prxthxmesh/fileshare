import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DeviceRecord, TextHistoryEntry, TransferRecord } from '@/types';

/**
 * FileShare's local database. Stores metadata only: settings, device records,
 * transfer history, and (opt-in) text history. File contents are never stored
 * here — partial received files live in the Origin Private File System and are
 * removed once saved or discarded.
 */
interface FileShareDB extends DBSchema {
  kv: { key: string; value: unknown };
  devices: { key: string; value: DeviceRecord; indexes: { lastConnected: number } };
  transfers: {
    key: string;
    value: TransferRecord;
    indexes: { startedAt: number; peerDeviceId: string };
  };
  texts: { key: string; value: TextHistoryEntry; indexes: { at: number } };
}

export const DB_NAME = 'fileshare';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<FileShareDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<FileShareDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FileShareDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('kv');
        const devices = db.createObjectStore('devices', { keyPath: 'deviceId' });
        devices.createIndex('lastConnected', 'lastConnected');
        const transfers = db.createObjectStore('transfers', { keyPath: 'id' });
        transfers.createIndex('startedAt', 'startedAt');
        transfers.createIndex('peerDeviceId', 'peerDeviceId');
        const texts = db.createObjectStore('texts', { keyPath: 'id' });
        texts.createIndex('at', 'at');
      },
      blocked() {
        console.warn('[FileShare] Database upgrade blocked by another open tab.');
      },
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await getDb()).get('kv', key) as Promise<T | undefined>;
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  await (await getDb()).put('kv', value, key);
}

export async function kvDelete(key: string): Promise<void> {
  await (await getDb()).delete('kv', key);
}

/** Deletes every FileShare store. Used by Settings › Clear All Data. */
export async function clearAllData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['kv', 'devices', 'transfers', 'texts'], 'readwrite');
  await Promise.all([
    tx.objectStore('kv').clear(),
    tx.objectStore('devices').clear(),
    tx.objectStore('transfers').clear(),
    tx.objectStore('texts').clear(),
    tx.done,
  ]);
}

/** Test hook: closes and forgets the cached connection. */
export async function resetDbConnection() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}
