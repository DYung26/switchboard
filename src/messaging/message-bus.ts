import type {
  Logger,
  MessageBus,
  MessageEnvelope,
  MessageHandler,
  RuntimeContext,
} from "@/types";
import { createLogger } from "@/utils/logger";
import { withTimeout } from "@/utils/with-timeout";
import { MESSAGE_RESPONSE_TIMEOUT_MS } from "@/constants/app";

export function createChromeMessageBus(context: RuntimeContext): MessageBus {
  const logger = createLogger(context);
  const handlers = new Map<string, Set<MessageHandler>>();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const envelope = message as MessageEnvelope;
    const typeHandlers = handlers.get(envelope.type);

    if (!typeHandlers || typeHandlers.size === 0) {
      return false;
    }

    const [handler] = typeHandlers;
    Promise.resolve(handler!(envelope.payload, sender))
      .then(sendResponse)
      .catch((error: unknown) => {
        logger.error(`Handler for "${envelope.type}" failed`, error);
        sendResponse({ error: toErrorMessage(error) });
      });

    return true;
  });

  return {
    async send<TPayload, TResponse>(
      message: MessageEnvelope<string, TPayload>,
    ): Promise<TResponse> {
      const response = await withTimeout(
        chrome.runtime.sendMessage<MessageEnvelope<string, TPayload>, unknown>(
          message,
        ),
        MESSAGE_RESPONSE_TIMEOUT_MS,
      );
      if (isErrorResponse(response)) {
        throw new Error(response.error);
      }
      return response as TResponse;
    },

    async sendToTab<TPayload, TResponse>(
      tabId: number,
      message: MessageEnvelope<string, TPayload>,
    ): Promise<TResponse> {
      const response = await sendToTabWithInjectionRetry(tabId, message, logger);
      if (isErrorResponse(response)) {
        throw new Error(response.error);
      }
      return response as TResponse;
    },

    on<TPayload, TResponse>(
      type: string,
      handler: MessageHandler<TPayload, TResponse>,
    ): () => void {
      const typeHandlers =
        handlers.get(type) ?? new Set<MessageHandler>();
      typeHandlers.add(handler as MessageHandler);
      handlers.set(type, typeHandlers);

      return () => {
        typeHandlers.delete(handler as MessageHandler);
      };
    },
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isErrorResponse(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  );
}

// Chrome throws this exact message when `chrome.tabs.sendMessage` targets a
// tab with no listener registered - most commonly because the tab was
// already open before this extension's content script was (re)loaded, so
// Chrome's declarative `content_scripts` injection never ran in it. It also
// occurs on browser-internal pages the content script was never allowed to
// run on, which `injectContentScript` will fail to recover from too - that
// failure is left to propagate as-is.
const NO_RECEIVER_ERROR_MESSAGE =
  "Could not establish connection. Receiving end does not exist.";

function isNoReceiverError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(NO_RECEIVER_ERROR_MESSAGE);
}

async function injectContentScript(tabId: number): Promise<void> {
  const [contentScript] = chrome.runtime.getManifest().content_scripts ?? [];
  if (!contentScript?.js?.length) {
    throw new Error("No content script declared in the manifest to inject.");
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: contentScript.js,
  });
}

async function sendToTabWithInjectionRetry<TPayload>(
  tabId: number,
  message: MessageEnvelope<string, TPayload>,
  logger: Logger,
): Promise<unknown> {
  try {
    return await withTimeout(
      chrome.tabs.sendMessage<MessageEnvelope<string, TPayload>, unknown>(
        tabId,
        message,
      ),
      MESSAGE_RESPONSE_TIMEOUT_MS,
    );
  } catch (error) {
    if (!isNoReceiverError(error)) throw error;

    logger.debug(
      `No content script listening in tab ${tabId} for "${message.type}" - injecting and retrying once.`,
    );
    await injectContentScript(tabId);

    return withTimeout(
      chrome.tabs.sendMessage<MessageEnvelope<string, TPayload>, unknown>(
        tabId,
        message,
      ),
      MESSAGE_RESPONSE_TIMEOUT_MS,
    );
  }
}
