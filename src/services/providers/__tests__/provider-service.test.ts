import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGE_TYPE } from "@/constants/messages";
import type { MessageBus, MessageHandler } from "@/types";
import { createBrowserProviderService } from "../provider-service";
import { createChatGptProviderAdapter } from "../chatgpt/chatgpt-provider";



const CONVERSATION_ID = "6afcd90f-ca24-83e9-9d45-299e5d231014";

function buildService() {
  const handlers = new Map<string, MessageHandler>();
  const bus = {
    send: vi.fn(),
    sendToTab: vi.fn(),
    on(type: string, handler: MessageHandler) {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
  } as unknown as MessageBus;
  createBrowserProviderService(bus, [createChatGptProviderAdapter()]).init();

  async function trigger<T>(type: string, payload: unknown): Promise<T> {
    const handler = handlers.get(type);
    if (!handler) throw new Error(`No handler registered for "${type}"`);
    return (await handler(payload, {} as chrome.runtime.MessageSender)) as T;
  }

  return { trigger };
}

function buildChromeMocks(url = `https://chatgpt.com/c/${CONVERSATION_ID}`) {
  return {
    tabs: {
      get: vi.fn(async (id: number) => ({ id, url, status: "complete" })),
      query: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    scripting: {
      executeScript: vi.fn(async (): Promise<Array<{ result: unknown }>> => [{ result: { text: "ChatGPT response", conversationId: CONVERSATION_ID } }]),
    },
  };
}

describe("createBrowserProviderService", () => {
  let chromeMocks: ReturnType<typeof buildChromeMocks>;

  beforeEach(() => {
    chromeMocks = buildChromeMocks();
    vi.stubGlobal("chrome", chromeMocks);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns provider metadata from the registered adapter", async () => {
    const { trigger } = buildService();
    await expect(trigger(MESSAGE_TYPE.PROVIDER_GET, { provider: "chatgpt" }))
      .resolves.toEqual({ id: "chatgpt", origin: "https://chatgpt.com" });
  });

  it("sends a message through the explicitly selected provider tab", async () => {
    const { trigger } = buildService();

    const result = await trigger<{ text: string; conversationId?: string }>(MESSAGE_TYPE.PROVIDER_CHAT_COMPLETION_CREATE, {
      provider: "chatgpt",
      message: "Hello",
      conversationId: CONVERSATION_ID,
      tabId: 7,
    });

    expect(result).toEqual({ text: "ChatGPT response", conversationId: CONVERSATION_ID });
    expect(chromeMocks.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 7 },
      world: "MAIN",
    }));
  });

  it("rejects a selected tab outside the provider origin", async () => {
    chromeMocks.tabs.get.mockImplementation(async (id: number) => ({
      id,
      url: "https://example.com/",
      status: "complete",
    }));
    const { trigger } = buildService();

    await expect(trigger(MESSAGE_TYPE.PROVIDER_CHAT_COMPLETION_CREATE, { provider: "chatgpt", message: "Hello", tabId: 7 }))
      .rejects.toThrow("The selected browser tab is not a ChatGPT tab.");
    expect(chromeMocks.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("rejects unregistered providers", async () => {
    const { trigger } = buildService();
    await expect(trigger(MESSAGE_TYPE.PROVIDER_CHAT_COMPLETION_CREATE, {
      provider: "unknown",
      message: "Hello",
      tabId: 7,
    })).rejects.toThrow("Browser provider unknown is not supported.");
    expect(chromeMocks.tabs.get).not.toHaveBeenCalled();
  });

  it("rejects invalid messages before accessing browser tabs", async () => {
    const { trigger } = buildService();

    await expect(trigger(MESSAGE_TYPE.PROVIDER_CHAT_COMPLETION_CREATE, { provider: "chatgpt", message: "   ", tabId: 7 }))
      .rejects.toThrow("Message must contain between 1 and 32000 characters.");
    expect(chromeMocks.tabs.get).not.toHaveBeenCalled();
  });

  it("reads a conversation from the explicitly selected provider tab", async () => {
    chromeMocks.scripting.executeScript.mockResolvedValueOnce([{
      result: { id: CONVERSATION_ID, title: "Example", messages: [{ id: "m1", role: "user", content: "Hello" }] },
    }]);
    const { trigger } = buildService();

    const result = await trigger<{ id: string; title: string }>(MESSAGE_TYPE.PROVIDER_CONVERSATION_GET, {
      provider: "chatgpt",
      conversationId: CONVERSATION_ID,
      tabId: 7,
    });

    expect(result).toMatchObject({ id: CONVERSATION_ID, title: "Example" });
    expect(chromeMocks.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 7 },
      world: "MAIN",
    }));
  });
});
