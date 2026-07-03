import { MESSAGE_TYPE } from "@/constants/messages";
import type { CapturedCache, MessageBus } from "@/types";
import {
  clearCacheStorage,
  collectCacheStorage,
  isCacheStorageSupported,
  restoreCacheStorage,
} from "./cache-storage-bridge";

export function registerCacheStorageBridge(bus: MessageBus): void {
  bus.on<undefined, boolean>(MESSAGE_TYPE.CACHE_STORAGE_SUPPORTED, () =>
    isCacheStorageSupported(),
  );

  bus.on<undefined, CapturedCache[]>(MESSAGE_TYPE.CACHE_STORAGE_COLLECT, () =>
    collectCacheStorage(),
  );

  bus.on<undefined, void>(MESSAGE_TYPE.CACHE_STORAGE_CLEAR, () =>
    clearCacheStorage(),
  );

  bus.on<CapturedCache[], void>(
    MESSAGE_TYPE.CACHE_STORAGE_RESTORE,
    (cachesData) => restoreCacheStorage(cachesData),
  );
}
