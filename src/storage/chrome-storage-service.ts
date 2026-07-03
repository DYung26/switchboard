import type { StorageArea, StorageChangeListener, StorageService } from "@/types";
import { DEFAULT_STORAGE_AREA } from "@/constants/app";

export function createChromeStorageService(
  area: StorageArea = DEFAULT_STORAGE_AREA,
): StorageService {
  const storageArea = chrome.storage[area];

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const result = await storageArea.get(key);
      return result[key] as T | undefined;
    },

    async set<T>(key: string, value: T): Promise<void> {
      await storageArea.set({ [key]: value });
    },

    async remove(key: string): Promise<void> {
      await storageArea.remove(key);
    },

    watch<T>(key: string, listener: StorageChangeListener<T>): () => void {
      const onChanged = (
        changes: Record<string, chrome.storage.StorageChange>,
        changedArea: chrome.storage.AreaName,
      ) => {
        if (changedArea !== area || !(key in changes)) {
          return;
        }
        const change = changes[key]!;
        listener({
          oldValue: change.oldValue as T | undefined,
          newValue: change.newValue as T | undefined,
        });
      };

      chrome.storage.onChanged.addListener(onChanged);
      return () => chrome.storage.onChanged.removeListener(onChanged);
    },
  };
}
