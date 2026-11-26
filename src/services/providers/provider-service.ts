import type { BackgroundService } from "../background-service";
import type { MessageBus } from "@/types";
import { MESSAGE_TYPE } from "@/constants/messages";
import type { BrowserProviderAdapter, ProviderCompletionInput, ProviderConversationInput } from "./types";

interface ProviderCompletionPayload extends ProviderCompletionInput {
  provider: string;
}

interface ProviderConversationPayload extends ProviderConversationInput {
  provider: string;
}

export function createBrowserProviderService(
  bus: MessageBus,
  adapters: BrowserProviderAdapter[],
): BackgroundService {
  const providers = new Map(adapters.map((adapter) => [adapter.id, adapter]));

  function requireProvider(providerId: string): BrowserProviderAdapter {
    const provider = providers.get(providerId);
    if (!provider) throw new Error('Browser provider ' + providerId + ' is not supported.');
    return provider;
  }

  return {
    name: "browser-providers",
    init(): void {
      bus.on<{ provider: string }, Pick<BrowserProviderAdapter, "id" | "origin">>(
        MESSAGE_TYPE.PROVIDER_GET,
        async ({ provider }) => {
          const { id, origin } = requireProvider(provider);
          return { id, origin };
        },
      );
      bus.on<ProviderCompletionPayload, Awaited<ReturnType<BrowserProviderAdapter["createCompletion"]>>>(
        MESSAGE_TYPE.PROVIDER_CHAT_COMPLETION_CREATE,
        async ({ provider, ...payload }) => requireProvider(provider).createCompletion(payload),
      );
      bus.on<ProviderConversationPayload, Awaited<ReturnType<BrowserProviderAdapter["getConversation"]>>>(
        MESSAGE_TYPE.PROVIDER_CONVERSATION_GET,
        async ({ provider, ...payload }) => requireProvider(provider).getConversation(payload),
      );
    },
  };
}
