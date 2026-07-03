import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSnapshotService } from "../snapshot-service";
import { MESSAGE_TYPE } from "@/constants/messages";
import type { MessageBus, SessionSnapshot } from "@/types";
import { SNAPSHOT_SCHEMA_VERSION, STORAGE_MECHANISM } from "@/types";

const mockEngine = {
  captureCurrentSession: vi.fn(),
  restoreSession: vi.fn(),
  clearCurrentSession: vi.fn(),
};

vi.mock("../session-engine", () => ({
  createSessionEngine: vi.fn(() => mockEngine),
}));

interface TestMessageBus extends MessageBus {
  getHandler(type: string): (payload: unknown) => unknown;
}

function buildFakeBus(): TestMessageBus {
  const handlers = new Map<string, (payload: unknown) => unknown>();
  return {
    send: vi.fn(),
    sendToTab: vi.fn() as MessageBus["sendToTab"],
    on: vi.fn((type, handler) => {
      handlers.set(type, handler as (payload: unknown) => unknown);
      return () => {};
    }),
    getHandler: (type) => handlers.get(type)!,
  };
}

function buildSnapshot(): SessionSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    origin: "https://example.com",
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

describe("createSnapshotService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has the name 'snapshot'", () => {
    const service = createSnapshotService(buildFakeBus());
    expect(service.name).toBe("snapshot");
  });

  it("registers handlers for SESSION_CAPTURE, SESSION_RESTORE, and SESSION_CLEAR on init", () => {
    const bus = buildFakeBus();
    const service = createSnapshotService(bus);
    service.init();

    expect(bus.on).toHaveBeenCalledWith(
      MESSAGE_TYPE.SESSION_CAPTURE,
      expect.any(Function),
    );
    expect(bus.on).toHaveBeenCalledWith(
      MESSAGE_TYPE.SESSION_RESTORE,
      expect.any(Function),
    );
    expect(bus.on).toHaveBeenCalledWith(
      MESSAGE_TYPE.SESSION_CLEAR,
      expect.any(Function),
    );
  });

  it("SESSION_CAPTURE handler calls engine.captureCurrentSession and returns the snapshot", async () => {
    const snapshot = buildSnapshot();
    mockEngine.captureCurrentSession.mockResolvedValueOnce(snapshot);
    const bus = buildFakeBus();
    const service = createSnapshotService(bus);
    service.init();

    const result = await bus.getHandler(MESSAGE_TYPE.SESSION_CAPTURE)(
      undefined,
    );

    expect(mockEngine.captureCurrentSession).toHaveBeenCalled();
    expect(result).toBe(snapshot);
  });

  it("SESSION_RESTORE handler calls engine.restoreSession with the snapshot payload", async () => {
    mockEngine.restoreSession.mockResolvedValueOnce(undefined);
    const bus = buildFakeBus();
    const service = createSnapshotService(bus);
    service.init();

    const snapshot = buildSnapshot();
    await bus.getHandler(MESSAGE_TYPE.SESSION_RESTORE)(snapshot);

    expect(mockEngine.restoreSession).toHaveBeenCalledWith(snapshot);
  });

  it("SESSION_CLEAR handler calls engine.clearCurrentSession", async () => {
    mockEngine.clearCurrentSession.mockResolvedValueOnce(undefined);
    const bus = buildFakeBus();
    const service = createSnapshotService(bus);
    service.init();

    await bus.getHandler(MESSAGE_TYPE.SESSION_CLEAR)(undefined);

    expect(mockEngine.clearCurrentSession).toHaveBeenCalled();
  });

  it("propagates errors thrown by the engine to the message bus caller", async () => {
    const error = new Error("capture failed");
    mockEngine.captureCurrentSession.mockRejectedValueOnce(error);
    const bus = buildFakeBus();
    const service = createSnapshotService(bus);
    service.init();

    await expect(
      bus.getHandler(MESSAGE_TYPE.SESSION_CAPTURE)(undefined),
    ).rejects.toThrow("capture failed");
  });
});
