import { describe, expect, it } from "vitest";
import { sortAccounts } from "../sort-accounts";
import { SORT_ORDER } from "@/types/sort";
import type { SavedAccount } from "@/types/account";
import { SNAPSHOT_SCHEMA_VERSION } from "@/types";

function buildAccount(overrides: Partial<SavedAccount>): SavedAccount {
  return {
    id: overrides.id ?? "acc",
    origin: "https://example.com",
    name: overrides.name ?? "Account",
    snapshot: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      origin: "https://example.com",
      capturedAt: Date.now(),
      data: {
        cookies: [],
        localStorage: {},
        sessionStorage: {},
        indexedDB: [],
        cacheStorage: [],
      },
    },
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    lastUsed: undefined,
    ...overrides,
  };
}

describe("sortAccounts", () => {
  const accounts = [
    buildAccount({ id: "a", position: 2, createdAt: 1_000, lastUsed: 5_000 }),
    buildAccount({ id: "b", position: 0, createdAt: 3_000, lastUsed: undefined }),
    buildAccount({ id: "c", position: 1, createdAt: 2_000, lastUsed: 9_000 }),
  ];

  it("orders by custom position ascending", () => {
    const result = sortAccounts(accounts, SORT_ORDER.CUSTOM);
    expect(result.map((a) => a.id)).toEqual(["b", "c", "a"]);
  });

  it("orders by most recently created", () => {
    const result = sortAccounts(accounts, SORT_ORDER.CREATED);
    expect(result.map((a) => a.id)).toEqual(["b", "c", "a"]);
  });

  it("orders by most recently used, falling back to createdAt when never used", () => {
    const result = sortAccounts(accounts, SORT_ORDER.USED);
    expect(result.map((a) => a.id)).toEqual(["c", "a", "b"]);
  });

  it("does not mutate the input array", () => {
    const original = [...accounts];
    sortAccounts(accounts, SORT_ORDER.CREATED);
    expect(accounts).toEqual(original);
  });
});
