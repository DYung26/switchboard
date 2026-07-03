import { MESSAGE_TYPE } from "@/constants/messages";
import type { CapturedIndexedDbDatabase, MessageBus } from "@/types";
import {
  clearIndexedDb,
  collectIndexedDb,
  isIndexedDbSupported,
  restoreIndexedDb,
} from "./indexed-db-bridge";

export function registerIndexedDbBridge(bus: MessageBus): void {
  bus.on<undefined, boolean>(MESSAGE_TYPE.INDEXED_DB_SUPPORTED, () =>
    isIndexedDbSupported(),
  );

  bus.on<undefined, CapturedIndexedDbDatabase[]>(
    MESSAGE_TYPE.INDEXED_DB_COLLECT,
    () => collectIndexedDb(),
  );

  bus.on<undefined, void>(MESSAGE_TYPE.INDEXED_DB_CLEAR, () =>
    clearIndexedDb(),
  );

  bus.on<CapturedIndexedDbDatabase[], void>(
    MESSAGE_TYPE.INDEXED_DB_RESTORE,
    (databases) => restoreIndexedDb(databases),
  );
}
