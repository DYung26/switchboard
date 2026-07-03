import { SnapshotError } from "./snapshot-error";
import { SNAPSHOT_ERROR_CODE } from "./snapshot-error";

const UNSUPPORTED_URL_SCHEMES = ["chrome:", "edge:", "about:", "devtools:"];

export interface ActiveTabContext {
  tabId: number;
  origin: string;
}

export async function getActiveTabContext(): Promise<ActiveTabContext> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab || tab.id === undefined || !tab.url) {
    throw new SnapshotError(
      SNAPSHOT_ERROR_CODE.NO_ACTIVE_TAB,
      "No active tab could be found in the current window.",
    );
  }

  const url = parseTabUrl(tab.url);
  if (UNSUPPORTED_URL_SCHEMES.includes(url.protocol)) {
    throw new SnapshotError(
      SNAPSHOT_ERROR_CODE.UNSUPPORTED_PAGE,
      `Cannot capture session state on "${url.protocol}" pages.`,
    );
  }

  return { tabId: tab.id, origin: url.origin };
}

function parseTabUrl(rawUrl: string): URL {
  try {
    return new URL(rawUrl);
  } catch (error) {
    throw new SnapshotError(
      SNAPSHOT_ERROR_CODE.UNSUPPORTED_PAGE,
      `Tab URL "${rawUrl}" could not be parsed.`,
      error,
    );
  }
}
