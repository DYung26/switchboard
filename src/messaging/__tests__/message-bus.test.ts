import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMessageBus } from "../message-bus";

function stubChrome(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: { addListener: vi.fn() },
      getManifest: vi.fn(() => ({
        content_scripts: [{ js: ["src/content/index.ts"] }],
      })),
    },
    scripting: {
      executeScript: vi.fn(async () => undefined),
    },
    tabs: {
      sendMessage: vi.fn(),
    },
    ...overrides,
  });
}

describe("createChromeMessageBus sendToTab", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves with the tab's response on the first try", async () => {
    stubChrome();
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
    });
    const bus = createChromeMessageBus("background");

    await expect(
      bus.sendToTab(7, { type: "switchboard/ping", payload: undefined }),
    ).resolves.toEqual({ ok: true });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("injects the content script and retries once when no receiver exists", async () => {
    stubChrome();
    const sendMessage = chrome.tabs.sendMessage as ReturnType<typeof vi.fn>;
    sendMessage
      .mockRejectedValueOnce(
        new Error("Could not establish connection. Receiving end does not exist."),
      )
      .mockResolvedValueOnce({ ok: true });
    const bus = createChromeMessageBus("background");

    await expect(
      bus.sendToTab(7, { type: "switchboard/ping", payload: undefined }),
    ).resolves.toEqual({ ok: true });

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ["src/content/index.ts"],
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("does not retry for errors unrelated to a missing receiver", async () => {
    stubChrome();
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Some other failure"),
    );
    const bus = createChromeMessageBus("background");

    await expect(
      bus.sendToTab(7, { type: "switchboard/ping", payload: undefined }),
    ).rejects.toThrow("Some other failure");
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});
