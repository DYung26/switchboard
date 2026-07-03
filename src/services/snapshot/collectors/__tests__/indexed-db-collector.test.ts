import { describe, expect, it, vi } from "vitest";
import { createIndexedDbCollector } from "../indexed-db-collector";
import { MESSAGE_TYPE } from "@/constants/messages";
import type { CapturedIndexedDbDatabase, MessageBus } from "@/types";

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

const sampleDatabases: CapturedIndexedDbDatabase[] = [
  {
    name: "app-db",
    version: 1,
    objectStores: [
      {
        name: "items",
        keyPath: "id",
        autoIncrement: false,
        indexes: [],
        records: [],
      },
    ],
  },
];

describe("createIndexedDbCollector", () => {
  it("reports unsupported when the content script says IndexedDB isn't available", async () => {
    const bus = buildMessageBus({
      [MESSAGE_TYPE.INDEXED_DB_SUPPORTED]: () => false,
    });
    const collector = createIndexedDbCollector(bus);

    await expect(collector.isSupported!(7)).resolves.toBe(false);
  });

  it("treats a failed support check as unsupported rather than throwing", async () => {
    const bus = buildMessageBus();
    // No handler registered for INDEXED_DB_SUPPORTED -> sendToTab rejects.
    const collector = createIndexedDbCollector(bus);

    await expect(collector.isSupported!(7)).resolves.toBe(false);
  });

  it("collects databases from the content script when supported", async () => {
    const bus = buildMessageBus({
      [MESSAGE_TYPE.INDEXED_DB_SUPPORTED]: () => true,
      [MESSAGE_TYPE.INDEXED_DB_COLLECT]: () => sampleDatabases,
    });
    const collector = createIndexedDbCollector(bus);

    const result = await collector.collect("https://example.com", 7);

    expect(result).toBe(sampleDatabases);
    expect(bus.sendToTab).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: MESSAGE_TYPE.INDEXED_DB_COLLECT }),
    );
  });

  it("returns an empty array without messaging the tab when unsupported", async () => {
    const bus = buildMessageBus({
      [MESSAGE_TYPE.INDEXED_DB_SUPPORTED]: () => false,
    });
    const collector = createIndexedDbCollector(bus);

    const result = await collector.collect("https://example.com", 7);

    expect(result).toEqual([]);
    expect(bus.sendToTab).not.toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: MESSAGE_TYPE.INDEXED_DB_COLLECT }),
    );
  });

  it("skips clear/restore without messaging the tab when unsupported", async () => {
    const bus = buildMessageBus({
      [MESSAGE_TYPE.INDEXED_DB_SUPPORTED]: () => false,
    });
    const collector = createIndexedDbCollector(bus);

    await collector.clear("https://example.com", 7);
    await collector.restore("https://example.com", 7, sampleDatabases);

    expect(bus.sendToTab).not.toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: MESSAGE_TYPE.INDEXED_DB_CLEAR }),
    );
    expect(bus.sendToTab).not.toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: MESSAGE_TYPE.INDEXED_DB_RESTORE }),
    );
  });

  it("sends the restore payload to the tab when supported", async () => {
    const bus = buildMessageBus({
      [MESSAGE_TYPE.INDEXED_DB_SUPPORTED]: () => true,
      [MESSAGE_TYPE.INDEXED_DB_RESTORE]: () => undefined,
    });
    const collector = createIndexedDbCollector(bus);

    await collector.restore("https://example.com", 7, sampleDatabases);

    expect(bus.sendToTab).toHaveBeenCalledWith(7, {
      type: MESSAGE_TYPE.INDEXED_DB_RESTORE,
      payload: sampleDatabases,
    });
  });
});
