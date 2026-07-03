import type { CollectorRegistry } from "./collector-registry";
import { listMechanisms } from "./collector-registry";
import type { ClearSessionService } from "./clear-session-service";
import { getActiveTabContext } from "./tab-locator";
import { migrateSnapshot } from "./snapshot-migration";
import { assertValidSnapshot } from "./snapshot-validator";
import {
  SnapshotError,
  SNAPSHOT_ERROR_CODE,
  describeMechanismFailures,
  type MechanismFailure,
} from "./snapshot-error";
import type {
  SessionSnapshotData,
  StorageMechanism,
  StoredSessionSnapshot,
} from "@/types";
import { createLogger } from "@/utils/logger";

const logger = createLogger("background");

export interface RestoreSessionService {
  restoreSession(snapshot: StoredSessionSnapshot): Promise<void>;
}

// See `captureMechanism` in `capture-session-service.ts` for why this
// correlation has to go through a single type parameter.
async function restoreMechanism<TMechanism extends StorageMechanism>(
  registry: CollectorRegistry,
  mechanism: TMechanism,
  origin: string,
  tabId: number,
  data: SessionSnapshotData[TMechanism],
): Promise<void> {
  await registry[mechanism].restore(origin, tabId, data);
}

export function createRestoreSessionService(
  registry: CollectorRegistry,
  clearSessionService: ClearSessionService,
): RestoreSessionService {
  return {
    async restoreSession(stored: StoredSessionSnapshot): Promise<void> {
      const { tabId, origin } = await getActiveTabContext();

      // Snapshots are persisted to `chrome.storage.local` and can outlive
      // the extension version that wrote them, so a "current schema"
      // snapshot may actually be an older shape on disk. Migrate before
      // validating so `assertValidSnapshot` only ever sees the current
      // schema.
      const snapshot = migrateSnapshot(stored);
      assertValidSnapshot(snapshot, origin);

      // A partial clear failure (most commonly IndexedDB still held open by
      // the page itself) must never prevent the restore below from running.
      // `restore` on each mechanism already overwrites its data wholesale,
      // so skipping it here would leave the browser with whatever clear
      // managed to wipe and nothing put back - i.e. the user logged out of
      // both the old and the new account. Clear failures are collected and
      // surfaced as a warning after a successful restore instead of
      // aborting it.
      let clearFailures: MechanismFailure[] = [];
      try {
        await clearSessionService.clearOrigin(origin, tabId);
      } catch (error) {
        clearFailures =
          error instanceof SnapshotError && Array.isArray(error.cause)
            ? (error.cause as MechanismFailure[])
            : [{ mechanism: "clear", error }];
      }

      const mechanisms = listMechanisms(registry);
      const failures: MechanismFailure[] = [];

      for (const mechanism of mechanisms) {
        try {
          await restoreMechanism(
            registry,
            mechanism,
            origin,
            tabId,
            snapshot.data[mechanism],
          );
        } catch (error) {
          failures.push({ mechanism, error });
        }
      }

      if (failures.length > 0) {
        throw new SnapshotError(
          SNAPSHOT_ERROR_CODE.COLLECTOR_FAILURE,
          `Failed to restore ${failures.length} of ${mechanisms.length} storage mechanisms for ${origin}: ${describeMechanismFailures(failures)}`,
          failures,
        );
      }

      await chrome.tabs.update(tabId, { url: origin });

      if (clearFailures.length > 0) {
        logger.warn(
          `Restored ${origin} despite an incomplete pre-restore clear - stale data may remain for: ${describeMechanismFailures(clearFailures)}`,
        );
      }
    },
  };
}
