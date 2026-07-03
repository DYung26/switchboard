import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCookieCollector } from "../cookie-collector";
import { SnapshotError, SNAPSHOT_ERROR_CODE } from "../../snapshot-error";

function buildCookie(
  overrides: Partial<chrome.cookies.Cookie> = {},
): chrome.cookies.Cookie {
  return {
    name: "session_id",
    value: "abc123",
    domain: "example.com",
    hostOnly: true,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    session: false,
    expirationDate: 9999999999,
    storeId: "0",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("chrome", {
    cookies: {
      getAll: vi.fn(async () => [buildCookie()]),
      set: vi.fn(async () => buildCookie()),
      remove: vi.fn(async () => ({ url: "", name: "" })),
    },
  });
});

describe("createCookieCollector", () => {
  it("collects cookies for the registrable domain, not just the exact origin", async () => {
    const collector = createCookieCollector();
    await collector.collect("https://app.example.com", 1);

    expect(chrome.cookies.getAll).toHaveBeenCalledWith({
      domain: "example.com",
    });
  });

  it("clears cookies scoped to the registrable domain", async () => {
    const collector = createCookieCollector();
    await collector.clear("https://app.example.com", 1);

    expect(chrome.cookies.getAll).toHaveBeenCalledWith({
      domain: "example.com",
    });
    expect(chrome.cookies.remove).toHaveBeenCalledWith(
      expect.objectContaining({ name: "session_id" }),
    );
  });

  it("restores host-only cookies without forcing a domain attribute", async () => {
    const collector = createCookieCollector();
    const captured = await collector.collect("https://example.com", 1);
    await collector.restore("https://example.com", 1, captured);

    expect(chrome.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({ domain: undefined }),
    );
  });

  it("restores domain cookies with their original domain attribute", async () => {
    vi.stubGlobal("chrome", {
      cookies: {
        getAll: vi.fn(async () => [
          buildCookie({ hostOnly: false, domain: ".example.com" }),
        ]),
        set: vi.fn(async () => buildCookie()),
        remove: vi.fn(async () => ({ url: "", name: "" })),
      },
    });

    const collector = createCookieCollector();
    const captured = await collector.collect("https://example.com", 1);
    await collector.restore("https://example.com", 1, captured);

    expect(chrome.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({ domain: ".example.com" }),
    );
  });

  it("restores a cookie against its own subdomain, not the active tab's origin", async () => {
    vi.stubGlobal("chrome", {
      cookies: {
        getAll: vi.fn(async () => [
          buildCookie({ domain: "accounts.example.com", path: "/session" }),
        ]),
        set: vi.fn(async () => buildCookie()),
        remove: vi.fn(async () => ({ url: "", name: "" })),
      },
    });

    const collector = createCookieCollector();
    const captured = await collector.collect("https://app.example.com", 1);
    await collector.restore("https://app.example.com", 1, captured);

    expect(chrome.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://accounts.example.com/session",
      }),
    );
  });

  it("aggregates failures into a single SnapshotError", async () => {
    vi.stubGlobal("chrome", {
      cookies: {
        getAll: vi.fn(async () => [buildCookie()]),
        set: vi.fn(async () => {
          throw new Error("denied");
        }),
        remove: vi.fn(async () => ({ url: "", name: "" })),
      },
    });

    const collector = createCookieCollector();
    const captured = await collector.collect("https://example.com", 1);

    try {
      await collector.restore("https://example.com", 1, captured);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotError);
      expect((error as SnapshotError).code).toBe(
        SNAPSHOT_ERROR_CODE.COLLECTOR_FAILURE,
      );
    }
  });
});
