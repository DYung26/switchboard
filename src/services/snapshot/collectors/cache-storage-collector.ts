import type { CapturedCache, MessageBus } from "@/types";
import { STORAGE_MECHANISM } from "@/types";
import { MESSAGE_TYPE } from "@/constants/messages";
import type { StorageCollector } from "./storage-collector";

export function createCacheStorageCollector(
  bus: MessageBus,
): StorageCollector<typeof STORAGE_MECHANISM.CACHE_STORAGE> {
  async function checkSupported(tabId: number): Promise<boolean> {
    try {
      return await bus.sendToTab<undefined, boolean>(tabId, {
        type: MESSAGE_TYPE.CACHE_STORAGE_SUPPORTED,
        payload: undefined,
      });
    } catch {
      return false;
    }
  }

  return {
    mechanism: STORAGE_MECHANISM.CACHE_STORAGE,

    isSupported: checkSupported,

    async collect(_origin: string, tabId: number): Promise<CapturedCache[]> {
      if (!(await checkSupported(tabId))) return [];
      return bus.sendToTab(tabId, {
        type: MESSAGE_TYPE.CACHE_STORAGE_COLLECT,
        payload: undefined,
      });
    },

    async clear(_origin: string, tabId: number): Promise<void> {
      if (!(await checkSupported(tabId))) return;
      await bus.sendToTab(tabId, {
        type: MESSAGE_TYPE.CACHE_STORAGE_CLEAR,
        payload: undefined,
      });
    },

    async restore(
      _origin: string,
      tabId: number,
      data: CapturedCache[],
    ): Promise<void> {
      if (!(await checkSupported(tabId))) return;
      await bus.sendToTab(tabId, {
        type: MESSAGE_TYPE.CACHE_STORAGE_RESTORE,
        payload: data,
      });
    },
  };
}
