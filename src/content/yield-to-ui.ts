/**
 * Yields control back to the browser's event loop via a macrotask. Used
 * between IndexedDB/Cache Storage batches (never *inside* an open IndexedDB
 * transaction - see `indexed-db-bridge.ts` for why) so large snapshots
 * don't block page interaction for the whole capture/restore.
 */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
