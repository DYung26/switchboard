import type { Logger } from "@/types";
import type { SavedAccount } from "@/types/account";

function isSavedAccount(value: unknown): value is SavedAccount {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<SavedAccount>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.origin === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number" &&
    (candidate.lastUsed === undefined ||
      typeof candidate.lastUsed === "number") &&
    typeof candidate.snapshot === "object" &&
    candidate.snapshot !== null
  );
}

export function sanitizeAccounts(raw: unknown, logger: Logger): SavedAccount[] {
  if (raw === undefined) {
    return [];
  }

  if (!Array.isArray(raw)) {
    logger.warn("Discarding corrupted account list: expected an array.");
    return [];
  }

  return raw.filter((entry): entry is SavedAccount => {
    const valid = isSavedAccount(entry);
    if (!valid) {
      logger.warn("Discarding corrupted account entry.", entry);
    }
    return valid;
  });
}
