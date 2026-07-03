import type { MessageBus, StorageMechanism } from "@/types";
import { STORAGE_MECHANISM } from "@/types";
import type { StorageCollector } from "./collectors/storage-collector";
import { createCookieCollector } from "./collectors/cookie-collector";
import { createWebStorageCollector } from "./collectors/web-storage-collector";
import { createIndexedDbCollector } from "./collectors/indexed-db-collector";
import { createCacheStorageCollector } from "./collectors/cache-storage-collector";

export type CollectorRegistry = {
  [TMechanism in StorageMechanism]: StorageCollector<TMechanism>;
};

// Registration order determines restoration order (see `listMechanisms`,
// which relies on `Object.keys` insertion order). Cookies and web storage
// restore first since many sites read them synchronously on script
// evaluation; IndexedDB and Cache Storage are usually consumed by app code
// slightly later (after a service worker or module has initialized), so
// restoring them last minimizes the odds of the page reading half-restored
// state. The page is only reloaded once every mechanism has finished
// restoring (see `restore-session-service.ts`), so this ordering affects
// robustness to interruption more than end-state correctness.
export function createCollectorRegistry(bus: MessageBus): CollectorRegistry {
  return {
    [STORAGE_MECHANISM.COOKIES]: createCookieCollector(),
    [STORAGE_MECHANISM.LOCAL_STORAGE]: createWebStorageCollector(
      STORAGE_MECHANISM.LOCAL_STORAGE,
      bus,
    ),
    [STORAGE_MECHANISM.SESSION_STORAGE]: createWebStorageCollector(
      STORAGE_MECHANISM.SESSION_STORAGE,
      bus,
    ),
    [STORAGE_MECHANISM.INDEXED_DB]: createIndexedDbCollector(bus),
    [STORAGE_MECHANISM.CACHE_STORAGE]: createCacheStorageCollector(bus),
  };
}

export function listMechanisms(
  registry: CollectorRegistry,
): StorageMechanism[] {
  return Object.keys(registry) as StorageMechanism[];
}
