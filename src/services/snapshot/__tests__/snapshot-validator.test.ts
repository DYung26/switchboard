import { describe, expect, it } from "vitest";
import { assertValidSnapshot } from "../snapshot-validator";
import { SnapshotError, SNAPSHOT_ERROR_CODE } from "../snapshot-error";
import { SNAPSHOT_SCHEMA_VERSION } from "@/types";
import type { SessionSnapshot } from "@/types";

function buildSnapshot(
  overrides: Partial<SessionSnapshot> = {},
): SessionSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    origin: "https://example.com",
    capturedAt: Date.now(),
    data: {
      cookies: [],
      localStorage: {},
      sessionStorage: {},
      indexedDB: [],
      cacheStorage: [],
    },
    ...overrides,
  };
}

describe("assertValidSnapshot", () => {
  it("accepts a well-formed snapshot matching the expected origin", () => {
    const snapshot = buildSnapshot();
    expect(() =>
      assertValidSnapshot(snapshot, "https://example.com"),
    ).not.toThrow();
  });

  it("rejects a snapshot with an unsupported schema version", () => {
    const snapshot = {
      ...buildSnapshot(),
      schemaVersion: 99,
    } as unknown as SessionSnapshot;

    try {
      assertValidSnapshot(snapshot, "https://example.com");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotError);
      expect((error as SnapshotError).code).toBe(
        SNAPSHOT_ERROR_CODE.INVALID_SNAPSHOT,
      );
    }
  });

  it("rejects a snapshot whose origin does not match the active tab", () => {
    const snapshot = buildSnapshot({ origin: "https://other.com" });

    try {
      assertValidSnapshot(snapshot, "https://example.com");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotError);
      expect((error as SnapshotError).code).toBe(
        SNAPSHOT_ERROR_CODE.ORIGIN_MISMATCH,
      );
    }
  });

  it("rejects a snapshot missing a required storage mechanism", () => {
    const snapshot = buildSnapshot();
    const incomplete = {
      ...snapshot,
      data: { cookies: [], localStorage: {} },
    } as unknown as SessionSnapshot;

    try {
      assertValidSnapshot(incomplete, "https://example.com");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotError);
      expect((error as SnapshotError).code).toBe(
        SNAPSHOT_ERROR_CODE.INVALID_SNAPSHOT,
      );
    }
  });
});
