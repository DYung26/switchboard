import type { BackgroundService } from "./background-service";
import { createLogger } from "@/utils/logger";

const logger = createLogger("background");

export function createServiceRegistry() {
  const services: BackgroundService[] = [];

  return {
    register(service: BackgroundService): void {
      services.push(service);
    },

    async initAll(): Promise<void> {
      for (const service of services) {
        logger.debug(`Initializing service: ${service.name}`);
        await service.init();
      }
    },
  };
}
