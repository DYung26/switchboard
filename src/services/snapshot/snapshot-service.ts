import type { BackgroundService } from "../background-service";
import type { MessageBus, SessionSnapshot, StoredSessionSnapshot } from "@/types";
import { MESSAGE_TYPE } from "@/constants/messages";
import { createSessionEngine } from "./session-engine";

export function createSnapshotService(bus: MessageBus): BackgroundService {
  return {
    name: "snapshot",
    init(): void {
      const engine = createSessionEngine(bus);

      bus.on<undefined, SessionSnapshot>(MESSAGE_TYPE.SESSION_CAPTURE, () =>
        engine.captureCurrentSession(),
      );

      bus.on<StoredSessionSnapshot, void>(
        MESSAGE_TYPE.SESSION_RESTORE,
        (snapshot) => engine.restoreSession(snapshot),
      );

      bus.on<undefined, void>(MESSAGE_TYPE.SESSION_CLEAR, () =>
        engine.clearCurrentSession(),
      );
    },
  };
}
