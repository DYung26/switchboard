import { describe, expect, it } from "vitest";
import { filterAccountsByQuery } from "../filter-accounts";
import type { SavedAccount } from "@/types/account";
import { SNAPSHOT_SCHEMA_VERSION } from "@/types";

function buildAccount(name: string): SavedAccount {
  return {
    id: name,
    origin: "https://example.com",
    name,
    snapshot: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      origin: "https://example.com",
      capturedAt: Date.now(),
      data: { cookies: [], localStorage: {}, sessionStorage: {} },
    },
    createdAt: 0,
    updatedAt: 0,
    lastUsed: undefined,
  };
}

describe("filterAccountsByQuery", () => {
  const accounts = [
    buildAccount("Personal"),
    buildAccount("Work"),
    buildAccount("Client A"),
  ];

  it("returns every account when the query is empty", () => {
    expect(filterAccountsByQuery(accounts, "")).toEqual(accounts);
  });

  it("returns every account when the query is only whitespace", () => {
    expect(filterAccountsByQuery(accounts, "   ")).toEqual(accounts);
  });

  it("matches names case-insensitively", () => {
    expect(filterAccountsByQuery(accounts, "work")).toEqual([accounts[1]]);
  });

  it("matches a partial, non-prefix substring", () => {
    expect(filterAccountsByQuery(accounts, "ient")).toEqual([accounts[2]]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterAccountsByQuery(accounts, "nonexistent")).toEqual([]);
  });
});
