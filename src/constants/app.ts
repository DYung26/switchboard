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
