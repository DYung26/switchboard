import type { WebStorageRecords } from "@/types";
import { WEB_STORAGE_KIND } from "@/constants/web-storage";
import type { WebStorageKind } from "@/constants/web-storage";

export { WEB_STORAGE_KIND };
export type { WebStorageKind };

function resolveStorage(kind: WebStorageKind): Storage {
  return kind === WEB_STORAGE_KIND.LOCAL ? localStorage : sessionStorage;
}

export function collectWebStorage(kind: WebStorageKind): WebStorageRecords {
  const storage = resolveStorage(kind);
  const records: WebStorageRecords = {};

  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null) {
      records[key] = storage.getItem(key) ?? "";
    }
  }

  return records;
}

export function clearWebStorage(kind: WebStorageKind): void {
  resolveStorage(kind).clear();
}

export function restoreWebStorage(
  kind: WebStorageKind,
  records: WebStorageRecords,
): void {
  const storage = resolveStorage(kind);
  storage.clear();
  for (const [key, value] of Object.entries(records)) {
    storage.setItem(key, value);
  }
}
