import { describe, expect, it, vi } from "vitest";
import { createWebStorageCollector } from "../web-storage-collector";
import { MESSAGE_TYPE } from "@/constants/messages";
import { STORAGE_MECHANISM } from "@/types";
import type { MessageBus } from "@/types";

function buildMessageBus(sendToTabResult: unknown = undefined): MessageBus {
  return {
    send: vi.fn(),
    sendToTab: vi.fn(async () => sendToTabResult),
    on: vi.fn(),
  };
}

describe("createWebStorageCollector", () => {
  it("requests collection from the correct tab with the right storage kind", async () => {
    const bus = buildMessageBus({ theme: "dark" });
    const collector = createWebStorageCollector(
      STORAGE_MECHANISM.LOCAL_STORAGE,
      bus,
    );

    const result = await collector.collect("https://example.com", 42);

    expect(bus.sendToTab).toHaveBeenCalledWith(42, {
      type: MESSAGE_TYPE.WEB_STORAGE_COLLECT,
      payload: { kind: "local" },
    });
    expect(result).toEqual({ theme: "dark" });
  });

  it("requests clearing from the correct tab with the right storage kind", async () => {
    const bus = buildMessageBus();
    const collector = createWebStorageCollector(
      STORAGE_MECHANISM.SESSION_STORAGE,
      bus,
    );

    await collector.clear("https://example.com", 42);

    expect(bus.sendToTab).toHaveBeenCalledWith(42, {
      type: MESSAGE_TYPE.WEB_STORAGE_CLEAR,
      payload: { kind: "session" },
    });
  });

  it("requests restoration with the records payload", async () => {
    const bus = buildMessageBus();
    const collector = createWebStorageCollector(
      STORAGE_MECHANISM.LOCAL_STORAGE,
      bus,
    );

    await collector.restore("https://example.com", 42, { theme: "dark" });

    expect(bus.sendToTab).toHaveBeenCalledWith(42, {
      type: MESSAGE_TYPE.WEB_STORAGE_RESTORE,
      payload: { kind: "local", records: { theme: "dark" } },
    });
  });
});
