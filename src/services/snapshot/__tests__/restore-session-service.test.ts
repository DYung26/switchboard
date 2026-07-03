import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRestoreSessionService } from "../restore-session-service";
import { createClearSessionService } from "../clear-session-service";
import { SnapshotError, SNAPSHOT_ERROR_CODE } from "../snapshot-error";
import type { CollectorRegistry } from "../collector-registry";
import {
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION_V1,
  STORAGE_MECHANISM,
} from "@/types";
import type { SessionSnapshot, SessionSnapshotV1 } from "@/types";

function buildSnapshot(): SessionSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    origin: "https://example.com",
    capturedAt: Date.now(),
    data: {
      cookies: [],
      localStorage: { theme: "dark" },
      sessionStorage: {},
      indexedDB: [],
      cacheStorage: [],
    },
  };
}

function buildLegacySnapshot(): SessionSnapshotV1 {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION_V1,
    origin: "https://example.com",
    capturedAt: Date.now(),
    data: {
      cookies: [],
      localStorage: { theme: "dark" },
      sessionStorage: {},
    },
  };
}

function buildFakeRegistry(): CollectorRegistry {
  return {
    [STORAGE_MECHANISM.COOKIES]: {
      mechanism: STORAGE_MECHANISM.COOKIES,
      collect: vi.fn(async () => []),
      clear: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined),
    },
    [STORAGE_MECHANISM.LOCAL_STORAGE]: {
      mechanism: STORAGE_MECHANISM.LOCAL_STORAGE,
      collect: vi.fn(async () => ({})),
      clear: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined),
    },
    [STORAGE_MECHANISM.SESSION_STORAGE]: {
      mechanism: STORAGE_MECHANISM.SESSION_STORAGE,
      collect: vi.fn(async () => ({})),
      clear: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined),
    },
    [STORAGE_MECHANISM.INDEXED_DB]: {
      mechanism: STORAGE_MECHANISM.INDEXED_DB,
      collect: vi.fn(async () => []),
      clear: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined),
      isSupported: vi.fn(async () => true),
    },
    [STORAGE_MECHANISM.CACHE_STORAGE]: {
      mechanism: STORAGE_MECHANISM.CACHE_STORAGE,
      collect: vi.fn(async () => []),
      clear: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined),
      isSupported: vi.fn(async () => true),
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("chrome", {
    tabs: {
      query: vi.fn(async () => [
        { id: 7, url: "https://example.com/dashboard" },
      ]),
      update: vi.fn(async () => undefined),
    },
  });
});

describe("createRestoreSessionService", () => {
  it("clears, restores every mechanism, then reloads the tab", async () => {
    const registry = buildFakeRegistry();
    const clearService = createClearSessionService(registry);
    const restoreService = createRestoreSessionService(registry, clearService);

    await restoreService.restoreSession(buildSnapshot());

    for (const mechanism of Object.values(STORAGE_MECHANISM)) {
      expect(registry[mechanism].clear).toHaveBeenCalledWith(
        "https://example.com",
        7,
      );
      expect(registry[mechanism].restore).toHaveBeenCalledWith(
        "https://example.com",
        7,
        expect.anything(),
      );
    }
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, {
      url: "https://example.com",
    });
  });

  it("rejects a snapshot for a different origin without touching collectors", async () => {
    const registry = buildFakeRegistry();
    const clearService = createClearSessionService(registry);
    const restoreService = createRestoreSessionService(registry, clearService);
    const mismatched = { ...buildSnapshot(), origin: "https://other.com" };

    await expect(
      restoreService.restoreSession(mismatched),
    ).rejects.toMatchObject({ code: SNAPSHOT_ERROR_CODE.ORIGIN_MISMATCH });

    expect(registry[STORAGE_MECHANISM.COOKIES].clear).not.toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("does not reload the tab if a collector fails to restore", async () => {
    const registry = buildFakeRegistry();
    registry[STORAGE_MECHANISM.COOKIES].restore = vi.fn(async () => {
      throw new Error("boom");
    });
    const clearService = createClearSessionService(registry);
    const restoreService = createRestoreSessionService(registry, clearService);

    try {
      await restoreService.restoreSession(buildSnapshot());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotError);
      expect((error as SnapshotError).code).toBe(
        SNAPSHOT_ERROR_CODE.COLLECTOR_FAILURE,
      );
    }
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("still restores and reloads when clearing partially fails", async () => {
    const registry = buildFakeRegistry();
    registry[STORAGE_MECHANISM.INDEXED_DB].clear = vi.fn(async () => {
      throw new Error(
        "Failed to clear 5 of 5 IndexedDB database(s).",
      );
    });
    const clearService = createClearSessionService(registry);
    const restoreService = createRestoreSessionService(registry, clearService);

    await restoreService.restoreSession(buildSnapshot());

    for (const mechanism of Object.values(STORAGE_MECHANISM)) {
      expect(registry[mechanism].restore).toHaveBeenCalledWith(
        "https://example.com",
        7,
        expect.anything(),
      );
    }
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, {
      url: "https://example.com",
    });
  });

  it("migrates a legacy v1 snapshot before restoring, defaulting new mechanisms to empty", async () => {
    const registry = buildFakeRegistry();
    const clearService = createClearSessionService(registry);
    const restoreService = createRestoreSessionService(registry, clearService);

    await restoreService.restoreSession(buildLegacySnapshot());

    expect(registry[STORAGE_MECHANISM.INDEXED_DB].restore).toHaveBeenCalledWith(
      "https://example.com",
      7,
      [],
    );
    expect(
      registry[STORAGE_MECHANISM.CACHE_STORAGE].restore,
    ).toHaveBeenCalledWith("https://example.com", 7, []);
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, {
      url: "https://example.com",
    });
  });
});
