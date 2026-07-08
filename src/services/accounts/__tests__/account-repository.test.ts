import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountRepository } from "../account-repository";
import { AccountError, ACCOUNT_ERROR_CODE } from "../account-error";
import type { StorageService } from "@/types";
import type { SavedAccount } from "@/types/account";
import { SNAPSHOT_SCHEMA_VERSION } from "@/types";

function buildAccount(overrides: Partial<SavedAccount> = {}): SavedAccount {
  return {
    id: "acc-1",
    origin: "https://example.com",
    name: "Personal",
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
    createdAt: 1_000,
    updatedAt: 1_000,
    lastUsed: undefined,
    ...overrides,
  };
}

function buildFakeStorage(initial: Record<string, unknown> = {}): StorageService {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    watch: vi.fn(() => () => undefined),
  } as unknown as StorageService;
}

describe("createAccountRepository", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty list when nothing has been saved for an origin", async () => {
    const repository = createAccountRepository(buildFakeStorage());
    await expect(repository.listByOrigin("https://example.com")).resolves.toEqual(
      [],
    );
  });

  it("upserts a new account and lists it back", async () => {
    const repository = createAccountRepository(buildFakeStorage());
    const account = buildAccount();

    await repository.upsert(account);

    await expect(repository.listByOrigin(account.origin)).resolves.toEqual([
      account,
    ]);
  });

  it("replaces an existing account with the same id instead of duplicating it", async () => {
    const repository = createAccountRepository(buildFakeStorage());
    const account = buildAccount();
    await repository.upsert(account);

    const renamed = { ...account, name: "Work" };
    await repository.upsert(renamed);

    const accounts = await repository.listByOrigin(account.origin);
    expect(accounts).toEqual([renamed]);
  });

  it("orders accounts by position ascending", async () => {
    const repository = createAccountRepository(buildFakeStorage());
    const second = buildAccount({ id: "acc-1", position: 1 });
    const first = buildAccount({ id: "acc-2", position: 0 });
    await repository.upsert(second);
    await repository.upsert(first);

    const accounts = await repository.listByOrigin(second.origin);
    expect(accounts.map((a) => a.id)).toEqual(["acc-2", "acc-1"]);
  });

  it("deletes an account by id", async () => {
    const repository = createAccountRepository(buildFakeStorage());
    const account = buildAccount();
    await repository.upsert(account);

    await repository.delete(account.origin, account.id);

    await expect(repository.listByOrigin(account.origin)).resolves.toEqual([]);
  });

  it("finds an account by id", async () => {
    const repository = createAccountRepository(buildFakeStorage());
    const account = buildAccount();
    await repository.upsert(account);

    await expect(
      repository.getById(account.origin, account.id),
    ).resolves.toEqual(account);
  });

  it("discards corrupted stored entries instead of throwing", async () => {
    const account = buildAccount();
    const storage = buildFakeStorage({
      "accounts:https://example.com": [account, { garbage: true }, null],
    });
    const repository = createAccountRepository(storage);

    await expect(repository.listByOrigin(account.origin)).resolves.toEqual([
      account,
    ]);
  });

  it("treats a non-array stored value as no saved accounts", async () => {
    const storage = buildFakeStorage({
      "accounts:https://example.com": "not-an-array",
    });
    const repository = createAccountRepository(storage);

    await expect(
      repository.listByOrigin("https://example.com"),
    ).resolves.toEqual([]);
  });

  it("wraps storage read failures in an AccountError", async () => {
    const storage = buildFakeStorage();
    storage.get = vi.fn(async () => {
      throw new Error("disk full");
    });
    const repository = createAccountRepository(storage);

    await expect(
      repository.listByOrigin("https://example.com"),
    ).rejects.toMatchObject({ code: ACCOUNT_ERROR_CODE.STORAGE_FAILURE });
  });

  it("wraps storage write failures in an AccountError", async () => {
    const storage = buildFakeStorage();
    storage.set = vi.fn(async () => {
      throw new Error("quota exceeded");
    });
    const repository = createAccountRepository(storage);

    await expect(repository.upsert(buildAccount())).rejects.toBeInstanceOf(
      AccountError,
    );
  });

  it("assigns positions to legacy accounts missing one, ordered by createdAt", async () => {
    const legacy = buildAccount({ id: "acc-1", createdAt: 2_000 });
    const legacyRaw = { ...legacy } as Record<string, unknown>;
    delete legacyRaw.position;
    const olderLegacy = buildAccount({ id: "acc-2", createdAt: 1_000 });
    const olderLegacyRaw = { ...olderLegacy } as Record<string, unknown>;
    delete olderLegacyRaw.position;

    const storage = buildFakeStorage({
      "accounts:https://example.com": [legacyRaw, olderLegacyRaw],
    });
    const repository = createAccountRepository(storage);

    const accounts = await repository.listByOrigin("https://example.com");
    expect(accounts.map((a) => ({ id: a.id, position: a.position }))).toEqual([
      { id: "acc-2", position: 0 },
      { id: "acc-1", position: 1 },
    ]);
  });

  describe("reorder", () => {
    it("applies a new position to every account for the origin", async () => {
      const repository = createAccountRepository(buildFakeStorage());
      const a = buildAccount({ id: "a", position: 0 });
      const b = buildAccount({ id: "b", position: 1 });
      const c = buildAccount({ id: "c", position: 2 });
      await repository.upsert(a);
      await repository.upsert(b);
      await repository.upsert(c);

      const reordered = await repository.reorder(a.origin, ["c", "a", "b"]);

      expect(reordered.map((acc) => acc.id)).toEqual(["c", "a", "b"]);
      expect(reordered.map((acc) => acc.position)).toEqual([0, 1, 2]);
    });

    it("keeps accounts missing from orderedIds, appended after the ranked ones", async () => {
      const repository = createAccountRepository(buildFakeStorage());
      const a = buildAccount({ id: "a", position: 0 });
      const b = buildAccount({ id: "b", position: 1 });
      await repository.upsert(a);
      await repository.upsert(b);

      const reordered = await repository.reorder(a.origin, ["b"]);

      expect(reordered.map((acc) => acc.id)).toEqual(["b", "a"]);
    });
  });

  describe("active account tracking", () => {
    it("returns undefined when no account is active for an origin", async () => {
      const repository = createAccountRepository(buildFakeStorage());
      await expect(
        repository.getActiveId("https://example.com"),
      ).resolves.toBeUndefined();
    });

    it("persists and clears the active account id", async () => {
      const repository = createAccountRepository(buildFakeStorage());
      await repository.setActiveId("https://example.com", "acc-1");
      await expect(
        repository.getActiveId("https://example.com"),
      ).resolves.toBe("acc-1");

      await repository.clearActiveId("https://example.com");
      await expect(
        repository.getActiveId("https://example.com"),
      ).resolves.toBeUndefined();
    });
  });
});
