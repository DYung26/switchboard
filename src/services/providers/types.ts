export interface ProviderCompletionInput {
  message: string;
  conversationId?: string;
  tabId: number;
}

export interface ProviderConversationInput {
  conversationId: string;
  tabId: number;
}

export interface ProviderCompletionResult {
  text: string;
  conversationId?: string;
}

export interface ProviderConversationResult {
  id: string;
  title: string;
  messages: Array<{
    id: string;
    role: string;
    content: string;
  }>;
}

export interface BrowserProviderAdapter {
  id: string;
  origin: string;
  createCompletion(payload: ProviderCompletionInput): Promise<ProviderCompletionResult>;
  getConversation(payload: ProviderConversationInput): Promise<ProviderConversationResult>;
}
