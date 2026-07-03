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

  it("orders accounts by most recently used, falling back to most recently updated", async () => {
    const repository = createAccountRepository(buildFakeStorage());
    const older = buildAccount({ id: "acc-1", updatedAt: 1_000, lastUsed: 2_000 });
    const newer = buildAccount({ id: "acc-2", updatedAt: 5_000, lastUsed: undefined });
    await repository.upsert(older);
    await repository.upsert(newer);

    const accounts = await repository.listByOrigin(older.origin);
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
});
