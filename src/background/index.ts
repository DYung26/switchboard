import { createChromeMessageBus } from "@/messaging";
import {
  createServiceRegistry,
  createPingService,
  createSnapshotService,
} from "@/services";
import { createAccountRepository } from "@/services/accounts/account-repository";
import { createAccountService } from "@/services/accounts/account-service";
import { createSessionEngine } from "@/services/snapshot/session-engine";
import { createChromeStorageService } from "@/storage";
import { createLogger } from "@/utils/logger";
import { createNetworkService } from "@/services/network";

(globalThis as typeof globalThis & { __SWITCHBOARD_EXTENSION__?: boolean }).__SWITCHBOARD_EXTENSION__ = true;

const logger = createLogger("background");

async function main(): Promise<void> {
  const bus = createChromeMessageBus("background");
  const storage = createChromeStorageService();
  const registry = createServiceRegistry();

  const engine = createSessionEngine(bus);
  const repository = createAccountRepository(storage);

  registry.register(createPingService(bus));
  registry.register(createSnapshotService(bus));
  registry.register(createAccountService(bus, engine, repository));
  registry.register(createNetworkService(bus));

  await registry.initAll();
  logger.info("Background service worker initialized");
}

void main();
