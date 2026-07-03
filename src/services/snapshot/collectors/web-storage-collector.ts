import type { MessageBus, WebStorageRecords } from "@/types";
import { STORAGE_MECHANISM } from "@/types";
import { MESSAGE_TYPE } from "@/constants/messages";
import { WEB_STORAGE_KIND } from "@/constants/web-storage";
import type { StorageCollector } from "./storage-collector";

type WebStorageMechanism =
  | typeof STORAGE_MECHANISM.LOCAL_STORAGE
  | typeof STORAGE_MECHANISM.SESSION_STORAGE;

const MECHANISM_TO_KIND = {
  [STORAGE_MECHANISM.LOCAL_STORAGE]: WEB_STORAGE_KIND.LOCAL,
  [STORAGE_MECHANISM.SESSION_STORAGE]: WEB_STORAGE_KIND.SESSION,
} as const;

export function createWebStorageCollector(
  mechanism: WebStorageMechanism,
  bus: MessageBus,
): StorageCollector<WebStorageMechanism> {
  const kind = MECHANISM_TO_KIND[mechanism];

  return {
    mechanism,

    async collect(_origin: string, tabId: number): Promise<WebStorageRecords> {
      return bus.sendToTab(tabId, {
        type: MESSAGE_TYPE.WEB_STORAGE_COLLECT,
        payload: { kind },
      });
    },

    async clear(_origin: string, tabId: number): Promise<void> {
      await bus.sendToTab(tabId, {
        type: MESSAGE_TYPE.WEB_STORAGE_CLEAR,
        payload: { kind },
      });
    },

    async restore(
      _origin: string,
      tabId: number,
      data: WebStorageRecords,
    ): Promise<void> {
      await bus.sendToTab(tabId, {
        type: MESSAGE_TYPE.WEB_STORAGE_RESTORE,
        payload: { kind, records: data },
      });
    },
  };
}
