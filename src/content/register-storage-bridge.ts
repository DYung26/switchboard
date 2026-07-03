import { MESSAGE_TYPE } from "@/constants/messages";
import type { MessageBus, WebStorageRecords } from "@/types";
import {
  WEB_STORAGE_KIND,
  collectWebStorage,
  clearWebStorage,
  restoreWebStorage,
} from "./storage-bridge";
import type { WebStorageKind } from "./storage-bridge";

interface WebStorageRequest {
  kind: WebStorageKind;
}

interface WebStorageRestoreRequest extends WebStorageRequest {
  records: WebStorageRecords;
}

export function registerStorageBridge(bus: MessageBus): void {
  bus.on<WebStorageRequest, WebStorageRecords>(
    MESSAGE_TYPE.WEB_STORAGE_COLLECT,
    ({ kind }) => collectWebStorage(kind),
  );

  bus.on<WebStorageRequest, void>(MESSAGE_TYPE.WEB_STORAGE_CLEAR, ({ kind }) =>
    clearWebStorage(kind),
  );

  bus.on<WebStorageRestoreRequest, void>(
    MESSAGE_TYPE.WEB_STORAGE_RESTORE,
    ({ kind, records }) => restoreWebStorage(kind, records),
  );
}

export { WEB_STORAGE_KIND };
export type { WebStorageKind };
