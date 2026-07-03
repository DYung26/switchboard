import type { StorageService } from "@/types";
import type { SavedAccount } from "@/types/account";
import { accountStorageKey } from "@/constants/app";
import { createLogger } from "@/utils/logger";
import { AccountError, ACCOUNT_ERROR_CODE } from "./account-error";
import { sanitizeAccounts } from "./account-validator";

const logger = createLogger("background");

export interface AccountRepository {
  listByOrigin(origin: string): Promise<SavedAccount[]>;
  getById(origin: string, id: string): Promise<SavedAccount | undefined>;
  upsert(account: SavedAccount): Promise<void>;
  delete(origin: string, id: string): Promise<void>;
}

function byRecency(a: SavedAccount, b: SavedAccount): number {
  return (b.lastUsed ?? b.updatedAt) - (a.lastUsed ?? a.updatedAt);
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
      return [...accounts].sort(byRecency);
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
  };
}
