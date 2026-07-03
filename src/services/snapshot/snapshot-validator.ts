import type { SessionSnapshot } from "@/types";
import { SNAPSHOT_SCHEMA_VERSION, STORAGE_MECHANISM } from "@/types";
import { SnapshotError, SNAPSHOT_ERROR_CODE } from "./snapshot-error";

export function assertValidSnapshot(
  snapshot: SessionSnapshot,
  expectedOrigin: string,
): void {
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotError(
      SNAPSHOT_ERROR_CODE.INVALID_SNAPSHOT,
      `Unsupported snapshot schema version: ${snapshot.schemaVersion}.`,
    );
  }

  if (!snapshot.origin) {
    throw new SnapshotError(
      SNAPSHOT_ERROR_CODE.INVALID_SNAPSHOT,
      "Snapshot is missing an origin.",
    );
  }

  if (snapshot.origin !== expectedOrigin) {
    throw new SnapshotError(
      SNAPSHOT_ERROR_CODE.ORIGIN_MISMATCH,
      `Snapshot origin "${snapshot.origin}" does not match the active tab's origin "${expectedOrigin}".`,
    );
  }

  const requiredMechanisms = Object.values(STORAGE_MECHANISM);
  for (const mechanism of requiredMechanisms) {
    if (!(mechanism in snapshot.data)) {
      throw new SnapshotError(
        SNAPSHOT_ERROR_CODE.INVALID_SNAPSHOT,
        `Snapshot is missing data for mechanism "${mechanism}".`,
      );
    }
  }
}
