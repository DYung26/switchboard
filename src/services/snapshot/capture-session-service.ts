import type { CollectorRegistry } from "./collector-registry";
import { listMechanisms } from "./collector-registry";
import { getActiveTabContext } from "./tab-locator";
import {
  SnapshotError,
  SNAPSHOT_ERROR_CODE,
  describeMechanismFailures,
  type MechanismFailure,
} from "./snapshot-error";
import type { SessionSnapshot, SessionSnapshotData } from "@/types";
import { SNAPSHOT_SCHEMA_VERSION } from "@/types";

export interface CaptureSessionService {
  captureCurrentSession(): Promise<SessionSnapshot>;
}

export function createCaptureSessionService(
  registry: CollectorRegistry,
): CaptureSessionService {
  return {
    async captureCurrentSession(): Promise<SessionSnapshot> {
      const { tabId, origin } = await getActiveTabContext();
      const mechanisms = listMechanisms(registry);
      const data = {} as SessionSnapshotData;
      const failures: MechanismFailure[] = [];

      for (const mechanism of mechanisms) {
        try {
          data[mechanism] = await registry[mechanism].collect(origin, tabId);
        } catch (error) {
          failures.push({ mechanism, error });
        }
      }

      if (failures.length > 0) {
        throw new SnapshotError(
          SNAPSHOT_ERROR_CODE.COLLECTOR_FAILURE,
          `Failed to capture ${failures.length} of ${mechanisms.length} storage mechanisms for ${origin}: ${describeMechanismFailures(failures)}`,
          failures,
        );
      }

      return {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        origin,
        capturedAt: Date.now(),
        data,
      };
    },
  };
}
