import { useCallback } from 'react';
import { linkService } from '@/services/link/linkService';
import { displayName } from '@/services/storage/deviceRepository';
import { isReadyPhase, useConnectionStore } from '@/stores/connectionStore';
import { useDeviceStore } from '@/stores/deviceStore';
import { toast } from '@/stores/uiStore';
import type { DeviceRecord } from '@/types';
import { useShallow } from 'zustand/react/shallow';

/** Paired devices that support quick connect and aren't connected right now. */
export function usePairedOffline(): DeviceRecord[] {
  const devices = useDeviceStore((s) => s.devices);
  const connectedIds = useConnectionStore(
    useShallow((s) =>
      Object.values(s.peers)
        .filter((p) => isReadyPhase(p.phase))
        .map((p) => p.remote?.deviceId ?? ''),
    ),
  );
  return devices.filter((d) => d.trusted && d.linkSecret && !connectedIds.includes(d.deviceId));
}

export function useConnectDevice() {
  return useCallback(async (device: DeviceRecord): Promise<string | null> => {
    try {
      return await linkService.connect(device.deviceId);
    } catch (e) {
      toast({
        tone: 'error',
        title: `Couldn’t connect to ${displayName(device)}`,
        message: (e as Error).message,
      });
      return null;
    }
  }, []);
}
