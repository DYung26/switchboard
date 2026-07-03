import { describe, expect, it, vi } from "vitest";
import { createClearSessionService } from "../clear-session-service";
import { SnapshotError, SNAPSHOT_ERROR_CODE } from "../snapshot-error";
import type { CollectorRegistry } from "../collector-registry";
import { STORAGE_MECHANISM } from "@/types";

function buildFakeRegistry(
  overrides: Partial<CollectorRegistry> = {},
): CollectorRegistry {
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
    ...overrides,
  };
}

describe("createClearSessionService", () => {
  it("clears every registered mechanism for the origin", async () => {
    const registry = buildFakeRegistry();
    const service = createClearSessionService(registry);

    await service.clearOrigin("https://example.com", 7);

    for (const mechanism of Object.values(STORAGE_MECHANISM)) {
      expect(registry[mechanism].clear).toHaveBeenCalledWith(
        "https://example.com",
        7,
      );
    }
  });

  it("continues clearing remaining mechanisms after one fails, then throws", async () => {
    const registry = buildFakeRegistry({
      [STORAGE_MECHANISM.COOKIES]: {
        mechanism: STORAGE_MECHANISM.COOKIES,
        collect: vi.fn(async () => []),
        clear: vi.fn(async () => {
          throw new Error("permission denied");
        }),
        restore: vi.fn(async () => undefined),
      },
    });
    const service = createClearSessionService(registry);

    try {
      await service.clearOrigin("https://example.com", 7);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotError);
      expect((error as SnapshotError).code).toBe(
        SNAPSHOT_ERROR_CODE.COLLECTOR_FAILURE,
      );
    }

    expect(
      registry[STORAGE_MECHANISM.LOCAL_STORAGE].clear,
    ).toHaveBeenCalled();
    expect(
      registry[STORAGE_MECHANISM.SESSION_STORAGE].clear,
    ).toHaveBeenCalled();
  });
});
