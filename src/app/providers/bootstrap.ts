import { initIdentity } from '@/services/appContext';
import { linkService } from '@/services/link/linkService';
import { cleanupIncoming, storageNameFor } from '@/services/transfer/receiveStorage';
import { transferManager } from '@/services/transfer/transferManager';
import {
  listTransfers,
  markStaleTransfersInterrupted,
} from '@/services/storage/transferRepository';
import { useDeviceStore } from '@/stores/deviceStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransferStore } from '@/stores/transferStore';

const KEEP_RECEIVED_MS = 24 * 60 * 60 * 1000;

/** Loads local state before first render. Every step tolerates storage being unavailable. */
export async function bootstrap() {
  await useSettingsStore.getState().load();
  await initIdentity();
  await Promise.all([
    useDeviceStore.getState().load(),
    markStaleTransfersInterrupted().catch(() => 0),
  ]);
  const history = await listTransfers().catch(() => []);
  useTransferStore.getState().setHistory(history);
  linkService.init();

  // Housekeeping (non-blocking): keep received files and resumable partials from
  // the last 24 hours, delete older leftovers from FileShare's private storage.
  void (async () => {
    const cutoff = Date.now() - KEEP_RECEIVED_MS;
    const recent = history.filter(
      (r) =>
        r.direction === 'receive' && r.storage === 'opfs' && (r.endedAt ?? r.startedAt) > cutoff,
    );
    const keep = new Set<string>();
    for (const r of recent) for (const f of r.files) keep.add(storageNameFor(r.id, f.fileId));
    await cleanupIncoming(keep);
    await transferManager.restoreReceivedFiles(recent);
  })().catch(() => {});
}
