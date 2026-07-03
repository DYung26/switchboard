import type { BackgroundService } from "../background-service";
import type { MessageBus } from "@/types";
import type { SavedAccount } from "@/types/account";
import type { SessionEngine } from "../snapshot/session-engine";
import type { AccountRepository } from "./account-repository";
import { MESSAGE_TYPE } from "@/constants/messages";
import { getActiveTabContext } from "../snapshot/tab-locator";
import { AccountError, ACCOUNT_ERROR_CODE } from "./account-error";

interface SavePayload {
  name: string;
}

interface AccountRefPayload {
  accountId: string;
  origin: string;
}

interface RenamePayload extends AccountRefPayload {
  name: string;
}

function assertValidName(name: string): void {
  if (!name) {
    throw new AccountError(
      ACCOUNT_ERROR_CODE.INVALID_NAME,
      "Account name cannot be empty.",
    );
  }
}

function buildDuplicateName(existingNames: string[], baseName: string): string {
  const taken = new Set(existingNames.map((name) => name.toLowerCase()));
  let candidate = `${baseName} (Copy)`;
  let attempt = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${baseName} (Copy ${attempt})`;
    attempt += 1;
  }
  return candidate;
}

export function createAccountService(
  bus: MessageBus,
  engine: SessionEngine,
  repository: AccountRepository,
): BackgroundService {
  async function requireAccount(
    origin: string,
    accountId: string,
  ): Promise<SavedAccount> {
    const account = await repository.getById(origin, accountId);
    if (!account) {
      throw new AccountError(
        ACCOUNT_ERROR_CODE.NOT_FOUND,
        `Account "${accountId}" not found for origin "${origin}".`,
      );
    }
    return account;
  }

  async function assertUniqueName(
    origin: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const accounts = await repository.listByOrigin(origin);
    const collision = accounts.some(
      (a) => a.id !== excludeId && a.name.toLowerCase() === name.toLowerCase(),
    );
    if (collision) {
      throw new AccountError(
        ACCOUNT_ERROR_CODE.DUPLICATE_NAME,
        `An account named "${name}" already exists for this site.`,
      );
    }
  }

  return {
    name: "accounts",

    init(): void {
      bus.on<{ origin: string }, SavedAccount[]>(
        MESSAGE_TYPE.ACCOUNT_LIST,
        async ({ origin }) => {
          return repository.listByOrigin(origin);
        },
      );

      bus.on<SavePayload, SavedAccount>(
        MESSAGE_TYPE.ACCOUNT_SAVE,
        async ({ name }) => {
          const { origin } = await getActiveTabContext();
          const trimmedName = name.trim();
          assertValidName(trimmedName);
          await assertUniqueName(origin, trimmedName);

          const snapshot = await engine.captureCurrentSession();
          const now = Date.now();
          const account: SavedAccount = {
            id: crypto.randomUUID(),
            origin,
            name: trimmedName,
            snapshot,
            createdAt: now,
            updatedAt: now,
            lastUsed: undefined,
          };
          await repository.upsert(account);
          return account;
        },
      );

      bus.on<AccountRefPayload, void>(
        MESSAGE_TYPE.ACCOUNT_SWITCH,
        async ({ accountId, origin }) => {
          const account = await requireAccount(origin, accountId);
          await engine.restoreSession(account.snapshot);
          await repository.upsert({ ...account, lastUsed: Date.now() });
        },
      );

      bus.on<RenamePayload, SavedAccount>(
        MESSAGE_TYPE.ACCOUNT_RENAME,
        async ({ accountId, origin, name }) => {
          const account = await requireAccount(origin, accountId);
          const trimmedName = name.trim();
          assertValidName(trimmedName);
          await assertUniqueName(origin, trimmedName, accountId);

          const updated: SavedAccount = {
            ...account,
            name: trimmedName,
            updatedAt: Date.now(),
          };
          await repository.upsert(updated);
          return updated;
        },
      );

      bus.on<AccountRefPayload, SavedAccount>(
        MESSAGE_TYPE.ACCOUNT_REPLACE,
        async ({ accountId, origin }) => {
          const account = await requireAccount(origin, accountId);
          const snapshot = await engine.captureCurrentSession();
          const updated: SavedAccount = {
            ...account,
            snapshot,
            updatedAt: Date.now(),
          };
          await repository.upsert(updated);
          return updated;
        },
      );

      bus.on<AccountRefPayload, SavedAccount>(
        MESSAGE_TYPE.ACCOUNT_DUPLICATE,
        async ({ accountId, origin }) => {
          const account = await requireAccount(origin, accountId);
          const siblings = await repository.listByOrigin(origin);
          const name = buildDuplicateName(
            siblings.map((a) => a.name),
            account.name,
          );

          const now = Date.now();
          const duplicate: SavedAccount = {
            ...account,
            id: crypto.randomUUID(),
            name,
            createdAt: now,
            updatedAt: now,
            lastUsed: undefined,
          };
          await repository.upsert(duplicate);
          return duplicate;
        },
      );

      bus.on<AccountRefPayload, void>(
        MESSAGE_TYPE.ACCOUNT_DELETE,
        async ({ accountId, origin }) => {
          await requireAccount(origin, accountId);
          await repository.delete(origin, accountId);
        },
      );
    },
  };
}
