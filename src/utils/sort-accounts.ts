import type { SavedAccount } from "@/types/account";
import { SORT_ORDER, type SortOrder } from "@/types/sort";

function byCreatedAtDesc(a: SavedAccount, b: SavedAccount): number {
  return b.createdAt - a.createdAt;
}

function byLastUsedDesc(a: SavedAccount, b: SavedAccount): number {
  return (b.lastUsed ?? b.createdAt) - (a.lastUsed ?? a.createdAt);
}

function byPositionAsc(a: SavedAccount, b: SavedAccount): number {
  return a.position - b.position;
}

const COMPARATOR_BY_SORT_ORDER: Record<
  SortOrder,
  (a: SavedAccount, b: SavedAccount) => number
> = {
  [SORT_ORDER.CUSTOM]: byPositionAsc,
  [SORT_ORDER.CREATED]: byCreatedAtDesc,
  [SORT_ORDER.USED]: byLastUsedDesc,
};

export function sortAccounts(
  accounts: SavedAccount[],
  sortOrder: SortOrder,
): SavedAccount[] {
  return [...accounts].sort(COMPARATOR_BY_SORT_ORDER[sortOrder]);
}
