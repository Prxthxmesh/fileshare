import { useCallback, useState } from 'react';
import { transferManager } from '@/services/transfer/transferManager';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Cancelling loses progress, so ask first while bytes are moving
 * (progress-indicators.md: let people know when halting has a negative consequence).
 */
export function useCancelTransfer() {
  const confirm = useSettingsStore((s) => s.settings.confirmCancel);
  const [pending, setPending] = useState<string | null>(null);
  const request = useCallback(
    (id: string, inProgress: boolean) => {
      if (confirm && inProgress) setPending(id);
      else transferManager.cancel(id);
    },
    [confirm],
  );
  return {
    request,
    pending,
    confirm: () => {
      if (pending) transferManager.cancel(pending);
      setPending(null);
    },
    dismiss: () => setPending(null),
  };
}
