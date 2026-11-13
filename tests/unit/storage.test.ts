import { beforeEach, describe, expect, it } from 'vitest';
import { putDevice, listDevices, updateDevice } from '@/services/storage/deviceRepository';
import { clearAllData, resetDbConnection } from '@/services/storage/indexedDb';
import { loadSettings, saveSettings } from '@/services/storage/settingsRepository';
import {
  clearTransfers,
  getTransfer,
  listTransfers,
  markStaleTransfersInterrupted,
  putTransfer,
} from '@/services/storage/transferRepository';
import type { TransferRecord } from '@/types';

function record(id: string, overrides: Partial<TransferRecord> = {}): TransferRecord {
  return {
    id,
    direction: 'send',
    kind: 'files',
    peerDeviceId: 'peer-aaaaaaaa',
    peerName: 'Pixel',
    status: 'completed',
    files: [],
    totalBytes: 10,
    startedAt: Date.now(),
    ...overrides,
  };
}

describe('IndexedDB repositories', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('persists settings', async () => {
    const s = await loadSettings();
    await saveSettings({ ...s, deviceName: 'Studio iPad', theme: 'dark' });
    await resetDbConnection();
    const loaded = await loadSettings();
    expect(loaded.deviceName).toBe('Studio iPad');
    expect(loaded.theme).toBe('dark');
  });

  it('lists transfers newest first and clears per device', async () => {
    await putTransfer(record('t1', { startedAt: 1 }));
    await putTransfer(record('t2', { startedAt: 2, peerDeviceId: 'other-peer1' }));
    expect((await listTransfers()).map((r) => r.id)).toEqual(['t2', 't1']);
    await clearTransfers('peer-aaaaaaaa');
    expect((await listTransfers()).map((r) => r.id)).toEqual(['t2']);
  });

  it('marks transfers left running at shutdown as interrupted', async () => {
    await putTransfer(record('t3', { status: 'active' }));
    await putTransfer(record('t4', { status: 'completed' }));
    expect(await markStaleTransfersInterrupted()).toBe(1);
    expect((await getTransfer('t3'))?.status).toBe('interrupted');
    expect((await getTransfer('t4'))?.status).toBe('completed');
  });

  it('updates devices', async () => {
    await putDevice({
      deviceId: 'dev-11111111',
      name: 'Realme GT 6T',
      kind: 'phone',
      platform: 'Android',
      trusted: true,
      fingerprint: 'AB',
      firstSeen: 1,
      lastConnected: 1,
      transferCount: 0,
    });
    await updateDevice('dev-11111111', { trusted: false, fingerprint: undefined });
    const [d] = await listDevices();
    expect(d.trusted).toBe(false);
    expect(d.fingerprint).toBeUndefined();
  });
});
