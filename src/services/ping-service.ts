import type { BackgroundService } from "./background-service";
import type { MessageBus } from "@/types";
import { MESSAGE_TYPE } from "@/constants/messages";

export function createPingService(bus: MessageBus): BackgroundService {
  return {
    name: "ping",
    init(): void {
      bus.on<undefined, { ok: true }>(MESSAGE_TYPE.PING, () => ({ ok: true }));
    },
  };
}
