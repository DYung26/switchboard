import type { Logger } from "@/types";
import type { SavedAccount } from "@/types/account";

type RawSavedAccount = Omit<SavedAccount, "position"> & { position?: number };

function isRawSavedAccount(value: unknown): value is RawSavedAccount {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<RawSavedAccount>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.origin === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number" &&
    (candidate.lastUsed === undefined ||
      typeof candidate.lastUsed === "number") &&
    (candidate.position === undefined ||
      typeof candidate.position === "number") &&
    typeof candidate.snapshot === "object" &&
    candidate.snapshot !== null
  );
}

/**
 * Accounts saved before custom ordering shipped have no `position`. This
 * assigns them one, in createdAt order, without disturbing accounts that
 * already have an explicit position from a prior manual reorder.
 */
function backfillPositions(accounts: RawSavedAccount[]): SavedAccount[] {
  const knownPositions = accounts
    .map((account) => account.position)
    .filter((position): position is number => position !== undefined);
  let nextPosition =
    knownPositions.length > 0 ? Math.max(...knownPositions) + 1 : 0;

  return [...accounts]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((account) => ({
      ...account,
      position: account.position ?? nextPosition++,
    }));
}

export function sanitizeAccounts(raw: unknown, logger: Logger): SavedAccount[] {
  if (raw === undefined) {
    return [];
  }

  if (!Array.isArray(raw)) {
    logger.warn("Discarding corrupted account list: expected an array.");
    return [];
  }

  const valid = raw.filter((entry): entry is RawSavedAccount => {
    const isValid = isRawSavedAccount(entry);
    if (!isValid) {
      logger.warn("Discarding corrupted account entry.", entry);
    }
    return isValid;
  });

  return backfillPositions(valid);
}
