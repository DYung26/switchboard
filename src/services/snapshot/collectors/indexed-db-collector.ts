import type { CapturedIndexedDbDatabase, MessageBus } from "@/types";
import { STORAGE_MECHANISM } from "@/types";
import { MESSAGE_TYPE } from "@/constants/messages";
import type { StorageCollector } from "./storage-collector";

export function createIndexedDbCollector(
  bus: MessageBus,
): StorageCollector<typeof STORAGE_MECHANISM.INDEXED_DB> {
  async function checkSupported(tabId: number): Promise<boolean> {
    try {
      return await bus.sendToTab<undefined, boolean>(tabId, {
        type: MESSAGE_TYPE.INDEXED_DB_SUPPORTED,
        payload: undefined,
      });
    } catch {
      // No reachable content script, or the check itself failed - treat
      // the mechanism as unsupported for this tab rather than failing the
      // whole capture/clear/restore pass.
      return false;
    }
  }

  return {
    mechanism: STORAGE_MECHANISM.INDEXED_DB,

    isSupported: checkSupported,

    async collect(
      _origin: string,
      tabId: number,
    ): Promise<CapturedIndexedDbDatabase[]> {
      if (!(await checkSupported(tabId))) return [];
      return bus.sendToTab(tabId, {
        type: MESSAGE_TYPE.INDEXED_DB_COLLECT,
        payload: undefined,
      });
    },

    async clear(_origin: string, tabId: number): Promise<void> {
      if (!(await checkSupported(tabId))) return;
      await bus.sendToTab(tabId, {
        type: MESSAGE_TYPE.INDEXED_DB_CLEAR,
        payload: undefined,
      });
    },

    async restore(
      _origin: string,
      tabId: number,
      data: CapturedIndexedDbDatabase[],
    ): Promise<void> {
      if (!(await checkSupported(tabId))) return;
      await bus.sendToTab(tabId, {
        type: MESSAGE_TYPE.INDEXED_DB_RESTORE,
        payload: data,
      });
    },
  };
}
