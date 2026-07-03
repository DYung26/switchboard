import type { MessageBus, SessionSnapshot, StoredSessionSnapshot } from "@/types";
import { createCollectorRegistry } from "./collector-registry";
import { createCaptureSessionService } from "./capture-session-service";
import { createClearSessionService } from "./clear-session-service";
import { createRestoreSessionService } from "./restore-session-service";
import { getActiveTabContext } from "./tab-locator";

export interface SessionEngine {
  captureCurrentSession(): Promise<SessionSnapshot>;
  restoreSession(snapshot: StoredSessionSnapshot): Promise<void>;
  clearCurrentSession(): Promise<void>;
}

export function createSessionEngine(bus: MessageBus): SessionEngine {
  const registry = createCollectorRegistry(bus);
  const captureService = createCaptureSessionService(registry);
  const clearService = createClearSessionService(registry);
  const restoreService = createRestoreSessionService(registry, clearService);

  return {
    captureCurrentSession: captureService.captureCurrentSession,
    restoreSession: restoreService.restoreSession,
    async clearCurrentSession(): Promise<void> {
      const { tabId, origin } = await getActiveTabContext();
      await clearService.clearOrigin(origin, tabId);
      // await chrome.tabs.update(tabId, { url: origin });
    },
  };
}
