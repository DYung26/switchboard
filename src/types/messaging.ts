export interface MessageEnvelope<TType extends string = string, TPayload = unknown> {
  type: TType;
  payload: TPayload;
}

export type MessageHandler<TPayload = unknown, TResponse = unknown> = (
  payload: TPayload,
  sender: chrome.runtime.MessageSender,
) => TResponse | Promise<TResponse>;

export interface MessageBus {
  send<TPayload, TResponse>(
    message: MessageEnvelope<string, TPayload>,
  ): Promise<TResponse>;

  sendToTab<TPayload, TResponse>(
    tabId: number,
    message: MessageEnvelope<string, TPayload>,
  ): Promise<TResponse>;

  on<TPayload, TResponse>(
    type: string,
    handler: MessageHandler<TPayload, TResponse>,
  ): () => void;
}

export type EventListener<TDetail> = (detail: TDetail) => void;

export interface EventBus {
  emit<TDetail>(event: string, detail: TDetail): void;
  subscribe<TDetail>(
    event: string,
    listener: EventListener<TDetail>,
  ): () => void;
}
