import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionEngine } from "../session-engine";
import { SNAPSHOT_ERROR_CODE } from "../snapshot-error";
import { SNAPSHOT_SCHEMA_VERSION, STORAGE_MECHANISM } from "@/types";
import type { MessageBus, SessionSnapshot } from "@/types";
import { MESSAGE_TYPE } from "@/constants/messages";

function buildFakeBus(): MessageBus {
  return {
    send: vi.fn(),
    sendToTab: vi.fn(async () => ({})),
    on: vi.fn(() => () => {}),
  };
}

function stubChrome(tab: Partial<chrome.tabs.Tab> | undefined) {
  vi.stubGlobal("chrome", {
    cookies: {
      getAll: vi.fn(async () => []),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
    tabs: {
      query: vi.fn(async () => (tab ? [tab] : [])),
      update: vi.fn(async () => undefined),
    },
  });
}

function buildSnapshot(origin = "https://example.com"): SessionSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    origin,
    capturedAt: Date.now(),
    data: {
      [STORAGE_MECHANISM.COOKIES]: [],
      [STORAGE_MECHANISM.LOCAL_STORAGE]: {},
      [STORAGE_MECHANISM.SESSION_STORAGE]: {},
      [STORAGE_MECHANISM.INDEXED_DB]: [],
      [STORAGE_MECHANISM.CACHE_STORAGE]: [],
    },
  };
}

describe("createSessionEngine", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  describe("captureCurrentSession", () => {
    it("returns a snapshot for the active tab's origin", async () => {
      stubChrome({ id: 7, url: "https://example.com/path" });
      const bus = buildFakeBus();

      const engine = createSessionEngine(bus);
      const snapshot = await engine.captureCurrentSession();

      expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
      expect(snapshot.origin).toBe("https://example.com");
      expect(snapshot.capturedAt).toBeTypeOf("number");
    });

    it("sends web storage collect messages to the active tab via the bus", async () => {
      stubChrome({ id: 7, url: "https://example.com/" });
      const bus = buildFakeBus();
      vi.mocked(bus.sendToTab).mockImplementation(async (_tabId, msg) => {
        if (msg.type === MESSAGE_TYPE.WEB_STORAGE_COLLECT) {
          return { key: "value" };
        }
        return {};
      });

      const engine = createSessionEngine(bus);
      const snapshot = await engine.captureCurrentSession();

      expect(bus.sendToTab).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: MESSAGE_TYPE.WEB_STORAGE_COLLECT }),
      );
      expect(snapshot.data.localStorage).toEqual({ key: "value" });
    });

    it("propagates NO_ACTIVE_TAB when no tab is active", async () => {
      stubChrome(undefined);
      const engine = createSessionEngine(buildFakeBus());

      await expect(engine.captureCurrentSession()).rejects.toMatchObject({
        code: SNAPSHOT_ERROR_CODE.NO_ACTIVE_TAB,
      });
    });

    it("propagates UNSUPPORTED_PAGE for chrome:// tabs", async () => {
      stubChrome({ id: 7, url: "chrome://extensions" });
      const engine = createSessionEngine(buildFakeBus());

      await expect(engine.captureCurrentSession()).rejects.toMatchObject({
        code: SNAPSHOT_ERROR_CODE.UNSUPPORTED_PAGE,
      });
    });
  });

  describe("restoreSession", () => {
    it("reloads the tab after restoring all mechanisms", async () => {
      stubChrome({ id: 7, url: "https://example.com/" });
      const bus = buildFakeBus();
      vi.mocked(bus.sendToTab).mockResolvedValue(undefined);

      const engine = createSessionEngine(bus);
      await engine.restoreSession(buildSnapshot());

      expect(chrome.tabs.update).toHaveBeenCalledWith(7, {
        url: "https://example.com",
      });
    });

    it("sends web storage restore messages to the active tab via the bus", async () => {
      stubChrome({ id: 7, url: "https://example.com/" });
      const bus = buildFakeBus();
      vi.mocked(bus.sendToTab).mockResolvedValue(undefined);

      const engine = createSessionEngine(bus);
      await engine.restoreSession(buildSnapshot());

      expect(bus.sendToTab).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: MESSAGE_TYPE.WEB_STORAGE_RESTORE }),
      );
    });

    it("rejects with ORIGIN_MISMATCH when the snapshot is for a different origin", async () => {
      stubChrome({ id: 7, url: "https://other.com/" });
      const engine = createSessionEngine(buildFakeBus());

      await expect(
        engine.restoreSession(buildSnapshot("https://example.com")),
      ).rejects.toMatchObject({ code: SNAPSHOT_ERROR_CODE.ORIGIN_MISMATCH });

      expect(chrome.tabs.update).not.toHaveBeenCalled();
    });
  });

  describe("clearCurrentSession", () => {
    it("clears cookies for the active tab's origin", async () => {
      stubChrome({ id: 7, url: "https://example.com/page" });
      const bus = buildFakeBus();
      vi.mocked(bus.sendToTab).mockResolvedValue(undefined);

      const engine = createSessionEngine(bus);
      await engine.clearCurrentSession();

      expect(chrome.cookies.getAll).toHaveBeenCalledWith({
        url: "https://example.com",
      });
    });

    it("sends web storage clear messages to the active tab via the bus", async () => {
      stubChrome({ id: 7, url: "https://example.com/" });
      const bus = buildFakeBus();
      vi.mocked(bus.sendToTab).mockResolvedValue(undefined);

      const engine = createSessionEngine(bus);
      await engine.clearCurrentSession();

      expect(bus.sendToTab).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: MESSAGE_TYPE.WEB_STORAGE_CLEAR }),
      );
    });

    it("propagates NO_ACTIVE_TAB when no tab is active", async () => {
      stubChrome(undefined);
      const engine = createSessionEngine(buildFakeBus());

      await expect(engine.clearCurrentSession()).rejects.toMatchObject({
        code: SNAPSHOT_ERROR_CODE.NO_ACTIVE_TAB,
      });
    });
  });
});
