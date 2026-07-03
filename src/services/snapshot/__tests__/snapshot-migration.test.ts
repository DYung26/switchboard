import { describe, expect, it } from "vitest";
import { migrateSnapshot } from "../snapshot-migration";
import { SnapshotError, SNAPSHOT_ERROR_CODE } from "../snapshot-error";
import {
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION_V1,
} from "@/types";

describe("migrateSnapshot", () => {
  it("returns a current-schema snapshot unchanged", () => {
    const snapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      origin: "https://example.com",
      capturedAt: 123,
      data: {
        cookies: [],
        localStorage: {},
        sessionStorage: {},
        indexedDB: [],
        cacheStorage: [],
      },
    };

    expect(migrateSnapshot(snapshot)).toBe(snapshot);
  });

  it("upgrades a v1 snapshot, defaulting indexedDB and cacheStorage to empty arrays", () => {
    const legacy = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION_V1,
      origin: "https://example.com",
      capturedAt: 123,
      data: {
        cookies: [{ name: "session", value: "abc" }],
        localStorage: { theme: "dark" },
        sessionStorage: {},
      },
    };

    const migrated = migrateSnapshot(legacy);

    expect(migrated.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(migrated.origin).toBe("https://example.com");
    expect(migrated.data.cookies).toEqual(legacy.data.cookies);
    expect(migrated.data.localStorage).toEqual(legacy.data.localStorage);
    expect(migrated.data.indexedDB).toEqual([]);
    expect(migrated.data.cacheStorage).toEqual([]);
  });

  it("throws INVALID_SNAPSHOT for an unrecognized schema version", () => {
    const future = {
      schemaVersion: 99,
      origin: "https://example.com",
      capturedAt: 123,
      data: {},
    };

    try {
      migrateSnapshot(future);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotError);
      expect((error as SnapshotError).code).toBe(
        SNAPSHOT_ERROR_CODE.INVALID_SNAPSHOT,
      );
    }
  });

  it("throws INVALID_SNAPSHOT for a value with no schema version at all", () => {
    expect(() => migrateSnapshot({ origin: "https://example.com" })).toThrow(
      SnapshotError,
    );
    expect(() => migrateSnapshot(null)).toThrow(SnapshotError);
    expect(() => migrateSnapshot("garbage")).toThrow(SnapshotError);
  });
});
