import { createLogger } from "@/utils/logger";
import { createChromeMessageBus } from "@/messaging";
import { registerStorageBridge } from "./register-storage-bridge";
import { registerIndexedDbBridge } from "./register-indexed-db-bridge";
import { registerCacheStorageBridge } from "./register-cache-storage-bridge";

const logger = createLogger("content");

function main(): void {
  const bus = createChromeMessageBus("content");
  registerStorageBridge(bus);
  registerIndexedDbBridge(bus);
  registerCacheStorageBridge(bus);
  logger.debug("Content script loaded", window.location.href);
}

main();
