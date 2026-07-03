import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveTabContext } from "../tab-locator";
import { SnapshotError, SNAPSHOT_ERROR_CODE } from "../snapshot-error";

function stubActiveTab(tab: Partial<chrome.tabs.Tab> | undefined) {
  vi.stubGlobal("chrome", {
    tabs: {
      query: vi.fn(async () => (tab ? [tab] : [])),
    },
  });
}

describe("getActiveTabContext", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the tab id and origin for a normal page", async () => {
    stubActiveTab({ id: 7, url: "https://example.com/dashboard?tab=1" });

    const context = await getActiveTabContext();

    expect(context).toEqual({ tabId: 7, origin: "https://example.com" });
  });

  it("throws NO_ACTIVE_TAB when no tab is active", async () => {
    stubActiveTab(undefined);

    await expect(getActiveTabContext()).rejects.toMatchObject({
      code: SNAPSHOT_ERROR_CODE.NO_ACTIVE_TAB,
    });
  });

  it("throws NO_ACTIVE_TAB when the active tab has no url", async () => {
    stubActiveTab({ id: 7, url: undefined });

    await expect(getActiveTabContext()).rejects.toBeInstanceOf(SnapshotError);
  });

  it("throws UNSUPPORTED_PAGE for chrome:// pages", async () => {
    stubActiveTab({ id: 7, url: "chrome://extensions" });

    await expect(getActiveTabContext()).rejects.toMatchObject({
      code: SNAPSHOT_ERROR_CODE.UNSUPPORTED_PAGE,
    });
  });
});
