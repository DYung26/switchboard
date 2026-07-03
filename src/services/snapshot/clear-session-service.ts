import type { CollectorRegistry } from "./collector-registry";
import { listMechanisms } from "./collector-registry";
import {
  SnapshotError,
  SNAPSHOT_ERROR_CODE,
  describeMechanismFailures,
  type MechanismFailure,
} from "./snapshot-error";
import { createLogger } from "@/utils/logger";

const logger = createLogger("background");

export interface ClearSessionService {
  clearOrigin(origin: string, tabId: number): Promise<void>;
}

export function createClearSessionService(
  registry: CollectorRegistry,
): ClearSessionService {
  return {
    async clearOrigin(origin: string, tabId: number): Promise<void> {
      const mechanisms = listMechanisms(registry);
      const failures: MechanismFailure[] = [];

      for (const mechanism of mechanisms) {
        try {
          await registry[mechanism].clear(origin, tabId);
        } catch (error) {
          logger.warn(`Failed to clear "${mechanism}" for ${origin}`, error);
          failures.push({ mechanism, error });
        }
      }

      if (failures.length > 0) {
        throw new SnapshotError(
          SNAPSHOT_ERROR_CODE.COLLECTOR_FAILURE,
          `Failed to clear ${failures.length} of ${mechanisms.length} storage mechanisms for ${origin}: ${describeMechanismFailures(failures)}`,
          failures,
        );
      }
    },
  };
}
