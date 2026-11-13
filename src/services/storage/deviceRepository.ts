import type { DeviceRecord } from '@/types';
import { getDb } from './indexedDb';

export async function listDevices(): Promise<DeviceRecord[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('devices', 'lastConnected');
  return all.reverse();
}

export async function getDevice(deviceId: string): Promise<DeviceRecord | undefined> {
  return (await getDb()).get('devices', deviceId);
}

export async function putDevice(device: DeviceRecord): Promise<void> {
  await (await getDb()).put('devices', device);
}

export async function updateDevice(
  deviceId: string,
  patch: Partial<DeviceRecord>,
): Promise<DeviceRecord | undefined> {
  const db = await getDb();
  const tx = db.transaction('devices', 'readwrite');
  const existing = await tx.store.get(deviceId);
  if (!existing) {
    await tx.done;
    return undefined;
  }
  const next = { ...existing, ...patch, deviceId };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function deleteDevice(deviceId: string): Promise<void> {
  await (await getDb()).delete('devices', deviceId);
}

export function displayName(device: Pick<DeviceRecord, 'name' | 'customName'>): string {
  return device.customName?.trim() || device.name;
}
