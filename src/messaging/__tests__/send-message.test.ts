import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendMessage } from "../send-message";

describe("sendMessage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves with the response payload on success", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
    });

    await expect(sendMessage("switchboard/ping", undefined)).resolves.toEqual(
      { ok: true },
    );
  });

  it("throws when the background worker responds with an error", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ error: "Account not found." })),
      },
    });

    await expect(
      sendMessage("switchboard/account/switch", { accountId: "missing" }),
    ).rejects.toThrow("Account not found.");
  });
});
