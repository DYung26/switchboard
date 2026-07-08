import type { StorageService } from "@/types";
import type { SavedAccount } from "@/types/account";
import { accountStorageKey, activeAccountStorageKey } from "@/constants/app";
import { createLogger } from "@/utils/logger";
import { AccountError, ACCOUNT_ERROR_CODE } from "./account-error";
import { sanitizeAccounts } from "./account-validator";

const logger = createLogger("background");

export interface AccountRepository {
  listByOrigin(origin: string): Promise<SavedAccount[]>;
  getById(origin: string, id: string): Promise<SavedAccount | undefined>;
  upsert(account: SavedAccount): Promise<void>;
  delete(origin: string, id: string): Promise<void>;
  reorder(origin: string, orderedIds: string[]): Promise<SavedAccount[]>;
  getActiveId(origin: string): Promise<string | undefined>;
  setActiveId(origin: string, accountId: string): Promise<void>;
  clearActiveId(origin: string): Promise<void>;
}

function byPosition(a: SavedAccount, b: SavedAccount): number {
  return a.position - b.position;
}

export function createAccountRepository(
  storage: StorageService,
): AccountRepository {
  async function readAccounts(origin: string): Promise<SavedAccount[]> {
    let raw: unknown;
    try {
      raw = await storage.get<unknown>(accountStorageKey(origin));
    } catch (error) {
      throw new AccountError(
        ACCOUNT_ERROR_CODE.STORAGE_FAILURE,
        `Failed to read saved accounts for "${origin}".`,
        error,
      );
    }
    return sanitizeAccounts(raw, logger);
  }

  async function writeAccounts(
    origin: string,
    accounts: SavedAccount[],
  ): Promise<void> {
    try {
      await storage.set(accountStorageKey(origin), accounts);
    } catch (error) {
      throw new AccountError(
        ACCOUNT_ERROR_CODE.STORAGE_FAILURE,
        `Failed to save accounts for "${origin}".`,
        error,
      );
    }
  }

  return {
    async listByOrigin(origin: string): Promise<SavedAccount[]> {
      const accounts = await readAccounts(origin);
      return [...accounts].sort(byPosition);
    },

    async getById(
      origin: string,
      id: string,
    ): Promise<SavedAccount | undefined> {
      const accounts = await readAccounts(origin);
      return accounts.find((a) => a.id === id);
    },

    async upsert(account: SavedAccount): Promise<void> {
      const accounts = await readAccounts(account.origin);
      const index = accounts.findIndex((a) => a.id === account.id);
      if (index >= 0) {
        accounts[index] = account;
      } else {
        accounts.push(account);
      }
      await writeAccounts(account.origin, accounts);
    },

    async delete(origin: string, id: string): Promise<void> {
      const accounts = await readAccounts(origin);
      const filtered = accounts.filter((a) => a.id !== id);
      await writeAccounts(origin, filtered);
    },

    async reorder(
      origin: string,
      orderedIds: string[],
    ): Promise<SavedAccount[]> {
      const accounts = await readAccounts(origin);
      const rank = new Map(orderedIds.map((id, index) => [id, index]));

      const ranked = accounts
        .map((account) => ({ account, rank: rank.get(account.id) }))
        .filter(
          (entry): entry is { account: SavedAccount; rank: number } =>
            entry.rank !== undefined,
        )
        .sort((a, b) => a.rank - b.rank)
        .map((entry) => entry.account);

      const unranked = accounts.filter((account) => !rank.has(account.id));

      const positioned = [...ranked, ...unranked].map((account, index) => ({
        ...account,
        position: index,
      }));

      await writeAccounts(origin, positioned);
      return [...positioned].sort(byPosition);
    },

    async getActiveId(origin: string): Promise<string | undefined> {
      try {
        return await storage.get<string>(activeAccountStorageKey(origin));
      } catch (error) {
        throw new AccountError(
          ACCOUNT_ERROR_CODE.STORAGE_FAILURE,
          `Failed to read the active account for "${origin}".`,
          error,
        );
      }
    },

    async setActiveId(origin: string, accountId: string): Promise<void> {
      try {
        await storage.set(activeAccountStorageKey(origin), accountId);
      } catch (error) {
        throw new AccountError(
          ACCOUNT_ERROR_CODE.STORAGE_FAILURE,
          `Failed to save the active account for "${origin}".`,
          error,
        );
      }
    },

    async clearActiveId(origin: string): Promise<void> {
      try {
        await storage.remove(activeAccountStorageKey(origin));
      } catch (error) {
        throw new AccountError(
          ACCOUNT_ERROR_CODE.STORAGE_FAILURE,
          `Failed to clear the active account for "${origin}".`,
          error,
        );
      }
    },
  };
}
