import type { BrowserProviderAdapter, ProviderCompletionInput, ProviderConversationInput } from "../types";

const CHATGPT_ORIGIN = "https://chatgpt.com";
const TAB_LOAD_TIMEOUT_MS = 20_000;
const RESPONSE_TIMEOUT_MS = 120_000;
const RESPONSE_POLL_INTERVAL_MS = 300;
const RESPONSE_STABLE_POLLS = 3;

interface ChatGptMessage {
  id: string;
  role: string;
  content: string;
}

interface ChatGptConversation {
  id: string;
  title: string;
  messages: ChatGptMessage[];
}

interface ChatGptSendResult {
  text: string;
  conversationId?: string;
}

async function waitForTabLoad(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;

  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      finish(new Error("ChatGPT tab did not finish loading."));
    }, TAB_LOAD_TIMEOUT_MS);
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.get(tabId).then((currentTab) => {
      if (currentTab.status === "complete") finish();
    }).catch((error: unknown) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function getChatGptTab(
  conversationId?: string,
  targetTabId?: number,
): Promise<chrome.tabs.Tab> {
  const conversationPath = conversationId ? `/c/${conversationId}` : undefined;
  let tab: chrome.tabs.Tab | undefined;

  if (targetTabId !== undefined) {
    tab = await chrome.tabs.get(targetTabId);
    if (!tab.url || new URL(tab.url).origin !== CHATGPT_ORIGIN) {
      throw new Error("The selected browser tab is not a ChatGPT tab.");
    }
  } else {
    const tabs = await chrome.tabs.query({ url: `${CHATGPT_ORIGIN}/*` });
    const matchingTabs = conversationPath
      ? tabs.filter((candidate) => new URL(candidate.url ?? CHATGPT_ORIGIN).pathname.startsWith(conversationPath))
      : tabs;
    tab = matchingTabs.find((candidate) => candidate.active) ?? matchingTabs[0];
  }

  if (!tab) {
    const url = conversationPath ? `${CHATGPT_ORIGIN}${conversationPath}` : CHATGPT_ORIGIN;
    tab = await chrome.tabs.create({ url, active: true });
  } else if (conversationPath && !new URL(tab.url ?? CHATGPT_ORIGIN).pathname.startsWith(conversationPath)) {
    tab = await chrome.tabs.update(tab.id!, { url: `${CHATGPT_ORIGIN}${conversationPath}` });
  } else if (!conversationId && !new URL(tab.url ?? CHATGPT_ORIGIN).pathname.startsWith("/c/")) {
    tab = await chrome.tabs.update(tab.id!, { url: CHATGPT_ORIGIN });
  }

  if (tab.id === undefined) throw new Error("Could not identify the ChatGPT browser tab.");
  await waitForTabLoad(tab.id);
  return tab;
}

async function sendChatGptMessage(tabId: number, message: string): Promise<ChatGptSendResult> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (input: { message: string; timeoutMs: number; pollIntervalMs: number; stablePolls: number }) => {
      const composer = document.querySelector<HTMLElement>(
        '[data-testid="prompt-textarea"], #prompt-textarea, textarea, [contenteditable="true"]',
      );
      if (!composer) throw new Error("ChatGPT composer was not found. Sign in and open a ChatGPT conversation.");

      const assistantMessages = () => Array.from(
        document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]'),
      );
      const previousAssistantText = assistantMessages().at(-1)?.innerText.trim() ?? "";
      const previousAssistantCount = assistantMessages().length;

      composer.focus();
      if (composer instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(composer, input.message);
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: input.message }));
      } else {
        document.execCommand("selectAll");
        document.execCommand("delete");
        document.execCommand("insertText", false, input.message);
      }

      const sendButton = document.querySelector<HTMLButtonElement>(
        '[data-testid="send-button"], button[aria-label*="Send"]',
      );
      if (!sendButton || sendButton.disabled) throw new Error("ChatGPT send button is unavailable.");
      sendButton.click();

      const deadline = Date.now() + input.timeoutMs;
      let stablePolls = 0;
      let previousText = previousAssistantText;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, input.pollIntervalMs));
        const latest = assistantMessages().at(-1)?.innerText.trim() ?? "";
        const isGenerating = Boolean(document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop generating"]'));
        const hasNewAssistantMessage = assistantMessages().length > previousAssistantCount || latest !== previousAssistantText;
        if (latest && hasNewAssistantMessage && latest === previousText && !isGenerating) {
          stablePolls += 1;
        } else {
          stablePolls = 0;
        }
        previousText = latest;
        if (stablePolls >= input.stablePolls) {
          const conversationId = location.pathname.match(/^\/c\/([^/]+)/)?.[1];
          return { text: latest, ...(conversationId ? { conversationId } : {}) };
        }
      }
      throw new Error("ChatGPT did not finish generating a response before the timeout.");
    },
    args: [{
      message,
      timeoutMs: RESPONSE_TIMEOUT_MS,
      pollIntervalMs: RESPONSE_POLL_INTERVAL_MS,
      stablePolls: RESPONSE_STABLE_POLLS,
    }],
  });

  if (!injection?.result) throw new Error("ChatGPT did not return a response.");
  return injection.result;
}

async function readChatGptConversation(tabId: number, conversationId: string): Promise<ChatGptConversation> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (id: string) => {
      const deadline = Date.now() + 30_000;
      let messages: ChatGptMessage[] = [];
      while (Date.now() < deadline) {
        messages = Array.from(document.querySelectorAll<HTMLElement>("[data-message-author-role]"))
          .map((element, index) => ({
            id: element.getAttribute("data-message-id") ?? `message-${index}`,
            role: element.getAttribute("data-message-author-role") ?? "unknown",
            content: element.innerText.trim(),
          }))
          .filter((message) => message.content.length > 0);
        if (messages.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (messages.length === 0) throw new Error("No conversation messages were rendered. Check that the account is signed in and the conversation is accessible.");
      return { id, title: document.title, messages };
    },
    args: [conversationId],
  });

  if (!injection?.result) throw new Error("ChatGPT conversation could not be read.");
  return injection.result;
}

export function createChatGptProviderAdapter(): BrowserProviderAdapter {
  return {
    id: "chatgpt",
    origin: CHATGPT_ORIGIN,
    async createCompletion({ message, conversationId, tabId }: ProviderCompletionInput) {
      if (typeof message !== "string" || message.trim().length === 0 || message.length > 32_000) {
        throw new Error("Message must contain between 1 and 32000 characters.");
      }
      if (conversationId && !/^[0-9a-f-]{36}$/i.test(conversationId)) {
        throw new Error("Conversation ID must be a UUID.");
      }
      const tab = await getChatGptTab(conversationId, tabId);
      return sendChatGptMessage(tab.id!, message);
    },
    async getConversation({ conversationId, tabId }: ProviderConversationInput) {
      if (!/^[0-9a-f-]{36}$/i.test(conversationId)) {
        throw new Error("Conversation ID must be a UUID.");
      }
      const tab = await getChatGptTab(conversationId, tabId);
      return readChatGptConversation(tab.id!, conversationId);
    },
  };
}
