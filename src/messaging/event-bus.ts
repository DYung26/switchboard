import type { EventBus, EventListener } from "@/types";

export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<EventListener<unknown>>>();

  return {
    emit<TDetail>(event: string, detail: TDetail): void {
      const eventListeners = listeners.get(event);
      if (!eventListeners) {
        return;
      }
      for (const listener of eventListeners) {
        listener(detail);
      }
    },

    subscribe<TDetail>(
      event: string,
      listener: EventListener<TDetail>,
    ): () => void {
      const eventListeners =
        listeners.get(event) ?? new Set<EventListener<unknown>>();
      eventListeners.add(listener as EventListener<unknown>);
      listeners.set(event, eventListeners);

      return () => {
        eventListeners.delete(listener as EventListener<unknown>);
      };
    },
  };
}
