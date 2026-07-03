import type { SavedAccount } from "@/types/account";

export function filterAccountsByQuery(
  accounts: SavedAccount[],
  query: string,
): SavedAccount[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return accounts;
  }
  return accounts.filter((account) =>
    account.name.toLowerCase().includes(normalized),
  );
}
