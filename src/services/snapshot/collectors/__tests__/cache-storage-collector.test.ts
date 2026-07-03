import { describe, expect, it, vi } from "vitest";
import { createCacheStorageCollector } from "../cache-storage-collector";
import { MESSAGE_TYPE } from "@/constants/messages";
import type { CapturedCache, MessageBus } from "@/types";

function buildMessageBus(
  handlers: Partial<Record<string, (payload: unknown) => unknown>> = {},
): MessageBus {
  return {
    send: vi.fn(),
    sendToTab: vi.fn(async (_tabId: number, message: { type: string; payload: unknown }) => {
      const handler = handlers[message.type];
      if (!handler) {
        throw new Error(`No fake handler for "${message.type}"`);
      }
      return handler(message.payload);
    }) as MessageBus["sendToTab"],
    on: vi.fn(),
  };
}

const sampleCaches: CapturedCache[] = [
  {
    name: "v1-assets",
    entries: [
      {
        url: "https://example.com/app.js",
        method: "GET",
        requestHeaders: [],
        status: 200,
        statusText: "OK",
        responseHeaders: [["content-type", "text/javascript"]],
        bodyEncoding: "text",
        body: "console.log('hi')",
      },
    ],
  },
];

describe("createCacheStorageCollector", () => {
  it("reports unsupported when the content script says Cache Storage isn't available", async () => {
    const bus = buildMessageBus({
      [MESSAGE_TYPE.CACHE_STORAGE_SUPPORTED]: () => false,
    });
    const collector = createCacheStorageCollector(bus);

    await expect(collector.isSupported!(7)).resolves.toBe(false);
  });

  it("treats a failed support check as unsupported rather than throwing", async () => {
    const bus = buildMessageBus();
    const collector = createCacheStorageCollector(bus);

    await expect(collector.isSupported!(7)).resolves.toBe(false);
  });

  it("collects caches from the content script when supported", async () => {
    const bus = buildMessageBus({
      [MESSAGE_TYPE.CACHE_STORAGE_SUPPORTED]: () => true,
      [MESSAGE_TYPE.CACHE_STORAGE_COLLECT]: () => sampleCaches,
    });
    const collector = createCacheStorageCollector(bus);

    const result = await collector.collect("https://example.com", 7);

    expect(result).toBe(sampleCaches);
  });

  it("returns an empty array without messaging the tab when unsupported", async () => {
    const bus = buildMessageBus({
      [MESSAGE_TYPE.CACHE_STORAGE_SUPPORTED]: () => false,
    });
    const collector = createCacheStorageCollector(bus);

    const result = await collector.collect("https://example.com", 7);

    expect(result).toEqual([]);
    expect(bus.sendToTab).not.toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: MESSAGE_TYPE.CACHE_STORAGE_COLLECT }),
    );
  });

  it("sends the restore payload to the tab when supported", async () => {
    const bus = buildMessageBus({
      [MESSAGE_TYPE.CACHE_STORAGE_SUPPORTED]: () => true,
      [MESSAGE_TYPE.CACHE_STORAGE_RESTORE]: () => undefined,
    });
    const collector = createCacheStorageCollector(bus);

    await collector.restore("https://example.com", 7, sampleCaches);

    expect(bus.sendToTab).toHaveBeenCalledWith(7, {
      type: MESSAGE_TYPE.CACHE_STORAGE_RESTORE,
      payload: sampleCaches,
    });
  });
});
