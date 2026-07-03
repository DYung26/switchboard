import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountService } from "../account-service";
import { ACCOUNT_ERROR_CODE } from "../account-error";
import type { AccountRepository } from "../account-repository";
import type { SessionEngine } from "../../snapshot/session-engine";
import { MESSAGE_TYPE } from "@/constants/messages";
import type { MessageBus, MessageHandler } from "@/types";
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

function buildFakeBus() {
  const handlers = new Map<string, MessageHandler>();
  const bus = {
    send: vi.fn(),
    sendToTab: vi.fn(),
    on(type: string, handler: MessageHandler) {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
  } as unknown as MessageBus;
  async function trigger<T = unknown>(
    type: string,
    payload: unknown,
  ): Promise<T> {
    const handler = handlers.get(type);
    if (!handler) throw new Error(`No handler registered for "${type}"`);
    return (await handler(payload, {} as chrome.runtime.MessageSender)) as T;
  }
  return { bus, trigger };
}

function buildFakeRepository(initial: SavedAccount[] = []): AccountRepository {
  let accounts = [...initial];
  return {
    async listByOrigin(origin) {
      return accounts.filter((a) => a.origin === origin);
    },
    async getById(origin, id) {
      return accounts.find((a) => a.origin === origin && a.id === id);
    },
    async upsert(account) {
      const index = accounts.findIndex((a) => a.id === account.id);
      if (index >= 0) {
        accounts[index] = account;
      } else {
        accounts.push(account);
      }
    },
    async delete(origin, id) {
      accounts = accounts.filter((a) => !(a.origin === origin && a.id === id));
    },
  };
}

function buildFakeEngine(overrides: Partial<SessionEngine> = {}): SessionEngine {
  return {
    captureCurrentSession: vi.fn(async () => buildAccount().snapshot),
    restoreSession: vi.fn(async () => undefined),
    clearCurrentSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("createAccountService", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn(async () => [
          { id: 7, url: "https://example.com/dashboard" },
        ]),
      },
    });
  });

  it("saves a new account using the active tab's origin and a captured snapshot", async () => {
    const engine = buildFakeEngine();
    const repository = buildFakeRepository();
    const { bus, trigger } = buildFakeBus();
    createAccountService(bus, engine, repository).init();

    const saved = await trigger(MESSAGE_TYPE.ACCOUNT_SAVE, { name: "  Work  " });

    expect(saved).toMatchObject({ origin: "https://example.com", name: "Work" });
    expect(engine.captureCurrentSession).toHaveBeenCalledOnce();
    await expect(
      repository.listByOrigin("https://example.com"),
    ).resolves.toHaveLength(1);
  });

  it("rejects saving a blank account name", async () => {
    const { bus, trigger } = buildFakeBus();
    createAccountService(bus, buildFakeEngine(), buildFakeRepository()).init();

    await expect(
      trigger(MESSAGE_TYPE.ACCOUNT_SAVE, { name: "   " }),
    ).rejects.toMatchObject({ code: ACCOUNT_ERROR_CODE.INVALID_NAME });
  });

  it("rejects saving a name that already exists for the origin", async () => {
    const existing = buildAccount({ name: "Work" });
    const { bus, trigger } = buildFakeBus();
    createAccountService(
      bus,
      buildFakeEngine(),
      buildFakeRepository([existing]),
    ).init();

    await expect(
      trigger(MESSAGE_TYPE.ACCOUNT_SAVE, { name: "work" }),
    ).rejects.toMatchObject({ code: ACCOUNT_ERROR_CODE.DUPLICATE_NAME });
  });

  it("switches to an account and records lastUsed", async () => {
    const account = buildAccount();
    const engine = buildFakeEngine();
    const repository = buildFakeRepository([account]);
    const { bus, trigger } = buildFakeBus();
    createAccountService(bus, engine, repository).init();

    await trigger(MESSAGE_TYPE.ACCOUNT_SWITCH, {
      accountId: account.id,
      origin: account.origin,
    });

    expect(engine.restoreSession).toHaveBeenCalledWith(account.snapshot);
    const updated = await repository.getById(account.origin, account.id);
    expect(updated?.lastUsed).toBeTypeOf("number");
  });

  it("throws NOT_FOUND when switching to a missing account", async () => {
    const { bus, trigger } = buildFakeBus();
    createAccountService(bus, buildFakeEngine(), buildFakeRepository()).init();

    await expect(
      trigger(MESSAGE_TYPE.ACCOUNT_SWITCH, {
        accountId: "missing",
        origin: "https://example.com",
      }),
    ).rejects.toMatchObject({ code: ACCOUNT_ERROR_CODE.NOT_FOUND });
  });

  it("renames an account when the new name is unique", async () => {
    const account = buildAccount();
    const { bus, trigger } = buildFakeBus();
    createAccountService(
      bus,
      buildFakeEngine(),
      buildFakeRepository([account]),
    ).init();

    const renamed = await trigger(MESSAGE_TYPE.ACCOUNT_RENAME, {
      accountId: account.id,
      origin: account.origin,
      name: "Work",
    });

    expect(renamed).toMatchObject({ id: account.id, name: "Work" });
  });

  it("rejects renaming to a name already used by another account", async () => {
    const first = buildAccount({ id: "acc-1", name: "Personal" });
    const second = buildAccount({ id: "acc-2", name: "Work" });
    const { bus, trigger } = buildFakeBus();
    createAccountService(
      bus,
      buildFakeEngine(),
      buildFakeRepository([first, second]),
    ).init();

    await expect(
      trigger(MESSAGE_TYPE.ACCOUNT_RENAME, {
        accountId: first.id,
        origin: first.origin,
        name: "Work",
      }),
    ).rejects.toMatchObject({ code: ACCOUNT_ERROR_CODE.DUPLICATE_NAME });
  });

  it("allows renaming an account to the name it already has", async () => {
    const account = buildAccount({ name: "Personal" });
    const { bus, trigger } = buildFakeBus();
    createAccountService(
      bus,
      buildFakeEngine(),
      buildFakeRepository([account]),
    ).init();

    await expect(
      trigger(MESSAGE_TYPE.ACCOUNT_RENAME, {
        accountId: account.id,
        origin: account.origin,
        name: "Personal",
      }),
    ).resolves.toMatchObject({ name: "Personal" });
  });

  it("duplicates an account with a new id and a '(Copy)' name", async () => {
    const account = buildAccount({ name: "Personal" });
    const repository = buildFakeRepository([account]);
    const { bus, trigger } = buildFakeBus();
    createAccountService(bus, buildFakeEngine(), repository).init();

    const duplicate = await trigger<SavedAccount>(
      MESSAGE_TYPE.ACCOUNT_DUPLICATE,
      { accountId: account.id, origin: account.origin },
    );

    expect(duplicate.id).not.toBe(account.id);
    expect(duplicate.name).toBe("Personal (Copy)");
    expect(duplicate.snapshot).toEqual(account.snapshot);
    expect(duplicate.lastUsed).toBeUndefined();
    await expect(
      repository.listByOrigin(account.origin),
    ).resolves.toHaveLength(2);
  });

  it("avoids duplicate-name collisions across repeated duplications", async () => {
    const account = buildAccount({ name: "Personal" });
    const firstCopy = buildAccount({
      id: "acc-copy-1",
      name: "Personal (Copy)",
    });
    const repository = buildFakeRepository([account, firstCopy]);
    const { bus, trigger } = buildFakeBus();
    createAccountService(bus, buildFakeEngine(), repository).init();

    const duplicate = await trigger<SavedAccount>(
      MESSAGE_TYPE.ACCOUNT_DUPLICATE,
      { accountId: account.id, origin: account.origin },
    );

    expect(duplicate.name).toBe("Personal (Copy 2)");
  });

  it("deletes an existing account", async () => {
    const account = buildAccount();
    const repository = buildFakeRepository([account]);
    const { bus, trigger } = buildFakeBus();
    createAccountService(bus, buildFakeEngine(), repository).init();

    await trigger(MESSAGE_TYPE.ACCOUNT_DELETE, {
      accountId: account.id,
      origin: account.origin,
    });

    await expect(
      repository.listByOrigin(account.origin),
    ).resolves.toEqual([]);
  });

  it("throws NOT_FOUND when deleting a missing account", async () => {
    const { bus, trigger } = buildFakeBus();
    createAccountService(bus, buildFakeEngine(), buildFakeRepository()).init();

    await expect(
      trigger(MESSAGE_TYPE.ACCOUNT_DELETE, {
        accountId: "missing",
        origin: "https://example.com",
      }),
    ).rejects.toMatchObject({ code: ACCOUNT_ERROR_CODE.NOT_FOUND });
  });
});
