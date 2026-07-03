import type { SessionSnapshot, SessionSnapshotV1, StoredSessionSnapshot } from "@/types";
import { SNAPSHOT_SCHEMA_VERSION, SNAPSHOT_SCHEMA_VERSION_V1 } from "@/types";
import { SnapshotError, SNAPSHOT_ERROR_CODE } from "./snapshot-error";

/**
 * Upgrades a snapshot of any known schema version to the current schema.
 * Snapshots saved before Advanced Browser Storage Support shipped only
 * have `cookies`/`localStorage`/`sessionStorage`; this fills in empty
 * `indexedDB`/`cacheStorage` arrays for them so the rest of the engine
 * never has to special-case older data.
 *
 * Accepts `unknown` (not just `StoredSessionSnapshot`) because the value
 * ultimately originates from `chrome.storage.local`, which is untyped at
 * the JS boundary - a persisted snapshot's real shape is only ever as
 * trustworthy as what was written to disk.
 */
export function migrateSnapshot(raw: unknown): SessionSnapshot {
  if (typeof raw !== "object" || raw === null || !("schemaVersion" in raw)) {
    throw new SnapshotError(
      SNAPSHOT_ERROR_CODE.INVALID_SNAPSHOT,
      "Snapshot is missing a schema version.",
    );
  }

  const schemaVersion = (raw as { schemaVersion: unknown }).schemaVersion;

  if (schemaVersion === SNAPSHOT_SCHEMA_VERSION) {
    return raw as SessionSnapshot;
  }

  if (schemaVersion === SNAPSHOT_SCHEMA_VERSION_V1) {
    const v1 = raw as SessionSnapshotV1;
    return {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      origin: v1.origin,
      capturedAt: v1.capturedAt,
      data: {
        ...v1.data,
        indexedDB: [],
        cacheStorage: [],
      },
    };
  }

  throw new SnapshotError(
    SNAPSHOT_ERROR_CODE.INVALID_SNAPSHOT,
    `Unsupported snapshot schema version: ${String(schemaVersion)}.`,
  );
}

export type { StoredSessionSnapshot };
