import { SORT_ORDER, type SortOrder } from "@/types/sort";

export const EXTENSION_NAME = "Switchboard";

export const STORAGE_AREA = {
  LOCAL: "local",
  SYNC: "sync",
  SESSION: "session",
} as const;

export const DEFAULT_STORAGE_AREA = STORAGE_AREA.LOCAL;

export const MESSAGE_RESPONSE_TIMEOUT_MS = 10_000;

export const ACCOUNTS_KEY_PREFIX = "accounts:";

export const accountStorageKey = (origin: string): string =>
  `${ACCOUNTS_KEY_PREFIX}${origin}`;

export const ACTIVE_ACCOUNT_KEY_PREFIX = "active-account:";

export const activeAccountStorageKey = (origin: string): string =>
  `${ACTIVE_ACCOUNT_KEY_PREFIX}${origin}`;

export const SORT_ORDER_STORAGE_KEY = "settings:sort-order";

export const DEFAULT_SORT_ORDER: SortOrder = SORT_ORDER.CUSTOM;
