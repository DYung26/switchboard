import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureSessionService } from "../capture-session-service";
import { SNAPSHOT_ERROR_CODE } from "../snapshot-error";
import type { CollectorRegistry } from "../collector-registry";
import { SNAPSHOT_SCHEMA_VERSION, STORAGE_MECHANISM } from "@/types";

function stubActiveTab(tab: Partial<chrome.tabs.Tab> | undefined) {
  vi.stubGlobal("chrome", {
    tabs: {
      query: vi.fn(async () => (tab ? [tab] : [])),
    },
  });
}

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
      collect: vi.fn(async () => ({ theme: "dark" })),
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

describe("createCaptureSessionService", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a snapshot containing the active tab's origin and all collected data", async () => {
    stubActiveTab({ id: 7, url: "https://example.com/dashboard?tab=1" });
    const registry = buildFakeRegistry();
    const service = createCaptureSessionService(registry);

    const snapshot = await service.captureCurrentSession();

    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.origin).toBe("https://example.com");
    expect(snapshot.capturedAt).toBeTypeOf("number");
    expect(snapshot.data.cookies).toEqual([]);
    expect(snapshot.data.localStorage).toEqual({ theme: "dark" });
    expect(snapshot.data.sessionStorage).toEqual({});
  });

  it("calls collect on every mechanism with the origin and tab id", async () => {
    stubActiveTab({ id: 7, url: "https://example.com/path" });
    const registry = buildFakeRegistry();
    const service = createCaptureSessionService(registry);

    await service.captureCurrentSession();

    for (const mechanism of Object.values(STORAGE_MECHANISM)) {
      expect(registry[mechanism].collect).toHaveBeenCalledWith(
        "https://example.com",
        7,
      );
    }
  });

  it("throws COLLECTOR_FAILURE when any mechanism fails to collect", async () => {
    stubActiveTab({ id: 7, url: "https://example.com/" });
    const registry = buildFakeRegistry({
      [STORAGE_MECHANISM.LOCAL_STORAGE]: {
        mechanism: STORAGE_MECHANISM.LOCAL_STORAGE,
        collect: vi.fn(async () => {
          throw new Error("quota exceeded");
        }),
        clear: vi.fn(async () => undefined),
        restore: vi.fn(async () => undefined),
      },
    });
    const service = createCaptureSessionService(registry);

    await expect(service.captureCurrentSession()).rejects.toMatchObject({
      code: SNAPSHOT_ERROR_CODE.COLLECTOR_FAILURE,
      message: expect.stringContaining("localStorage: quota exceeded"),
    });
  });

  it("attempts all mechanisms before throwing on partial failure", async () => {
    stubActiveTab({ id: 7, url: "https://example.com/" });
    const registry = buildFakeRegistry({
      [STORAGE_MECHANISM.COOKIES]: {
        mechanism: STORAGE_MECHANISM.COOKIES,
        collect: vi.fn(async () => {
          throw new Error("permission denied");
        }),
        clear: vi.fn(async () => undefined),
        restore: vi.fn(async () => undefined),
      },
    });
    const service = createCaptureSessionService(registry);

    await expect(service.captureCurrentSession()).rejects.toMatchObject({
      code: SNAPSHOT_ERROR_CODE.COLLECTOR_FAILURE,
    });

    expect(registry[STORAGE_MECHANISM.LOCAL_STORAGE].collect).toHaveBeenCalled();
    expect(registry[STORAGE_MECHANISM.SESSION_STORAGE].collect).toHaveBeenCalled();
  });

  it("propagates tab errors before attempting collection", async () => {
    stubActiveTab(undefined);
    const registry = buildFakeRegistry();
    const service = createCaptureSessionService(registry);

    await expect(service.captureCurrentSession()).rejects.toMatchObject({
      code: SNAPSHOT_ERROR_CODE.NO_ACTIVE_TAB,
    });

    for (const mechanism of Object.values(STORAGE_MECHANISM)) {
      expect(registry[mechanism].collect).not.toHaveBeenCalled();
    }
  });
});
