import { beforeEach, describe, expect, it } from "vitest";
import {
  WEB_STORAGE_KIND,
  collectWebStorage,
  clearWebStorage,
  restoreWebStorage,
} from "../storage-bridge";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("collectWebStorage", () => {
  it("collects every key/value pair from localStorage", () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("locale", "en-US");

    expect(collectWebStorage(WEB_STORAGE_KIND.LOCAL)).toEqual({
      theme: "dark",
      locale: "en-US",
    });
  });

  it("collects from sessionStorage independently of localStorage", () => {
    localStorage.setItem("theme", "dark");
    sessionStorage.setItem("draft", "hello");

    expect(collectWebStorage(WEB_STORAGE_KIND.SESSION)).toEqual({
      draft: "hello",
    });
  });

  it("returns an empty object when storage is empty", () => {
    expect(collectWebStorage(WEB_STORAGE_KIND.LOCAL)).toEqual({});
  });
});

describe("clearWebStorage", () => {
  it("removes all entries from the targeted storage only", () => {
    localStorage.setItem("theme", "dark");
    sessionStorage.setItem("draft", "hello");

    clearWebStorage(WEB_STORAGE_KIND.LOCAL);

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.getItem("draft")).toBe("hello");
  });
});

describe("restoreWebStorage", () => {
  it("replaces existing entries with the provided records", () => {
    localStorage.setItem("stale", "value");

    restoreWebStorage(WEB_STORAGE_KIND.LOCAL, { theme: "light" });

    expect(localStorage.getItem("stale")).toBeNull();
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("restores an empty snapshot as an empty storage area", () => {
    localStorage.setItem("stale", "value");

    restoreWebStorage(WEB_STORAGE_KIND.LOCAL, {});

    expect(localStorage.length).toBe(0);
  });
});
