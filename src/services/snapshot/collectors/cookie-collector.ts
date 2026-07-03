import type { CapturedCookie } from "@/types";
import { STORAGE_MECHANISM } from "@/types";
import { getRegistrableDomain } from "@/utils";
import { SnapshotError, SNAPSHOT_ERROR_CODE } from "../snapshot-error";
import type { StorageCollector } from "./storage-collector";

export function createCookieCollector(): StorageCollector<
  typeof STORAGE_MECHANISM.COOKIES
> {
  return {
    mechanism: STORAGE_MECHANISM.COOKIES,

    async collect(origin: string): Promise<CapturedCookie[]> {
      const cookies = await chrome.cookies.getAll({
        domain: getRegistrableDomain(new URL(origin).hostname),
      });
      return cookies.map(toCapturedCookie);
    },

    async clear(origin: string): Promise<void> {
      const cookies = await chrome.cookies.getAll({
        domain: getRegistrableDomain(new URL(origin).hostname),
      });
      await Promise.all(
        cookies.map((cookie) =>
          chrome.cookies.remove({
            url: buildCookieUrl(cookie),
            name: cookie.name,
            storeId: cookie.storeId,
          }),
        ),
      );
    },

    async restore(_origin: string, _tabId: number, data: CapturedCookie[]) {
      const failures: unknown[] = [];

      for (const cookie of data) {
        try {
          await chrome.cookies.set({
            url: buildCookieUrl(cookie),
            name: cookie.name,
            value: cookie.value,
            domain: cookie.hostOnly ? undefined : cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            expirationDate: cookie.expirationDate,
            storeId: cookie.storeId,
          });
        } catch (error) {
          failures.push(error);
        }
      }

      if (failures.length > 0) {
        throw new SnapshotError(
          SNAPSHOT_ERROR_CODE.COLLECTOR_FAILURE,
          `Failed to restore ${failures.length} of ${data.length} cookies.`,
          failures,
        );
      }
    },
  };
}

function toCapturedCookie(cookie: chrome.cookies.Cookie): CapturedCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    hostOnly: cookie.hostOnly,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate,
    storeId: cookie.storeId,
  };
}

// Cookies are captured across the whole registrable domain, so a cookie may
// belong to a different subdomain than the active tab (e.g. an SSO auth
// host). The URL for chrome.cookies.set/remove must therefore be derived
// from each cookie's own domain rather than the tab's origin.
function buildCookieUrl(
  cookie: Pick<CapturedCookie, "domain" | "path" | "secure">,
): string {
  const scheme = cookie.secure ? "https:" : "http:";
  const host = cookie.domain.replace(/^\./, "");
  return `${scheme}//${host}${cookie.path}`;
}
