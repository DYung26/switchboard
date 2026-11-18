export type AiSPProvider = "claude" | "chatgpt";

export interface ProviderConversationTarget {
  provider: AiSPProvider;
  conversationId: string;
}

export interface ProviderRequest {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
}

export interface CapturedProviderConversation {
  provider: AiSPProvider;
  conversationId: string;
  conversation: Record<string, unknown>;
}

export function identifyProviderConversation(pageUrl: string): ProviderConversationTarget {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    throw new Error("The active tab does not have a valid page URL.");
  }

  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com") {
    const conversationSegment = segments.lastIndexOf("c");
    const conversationId = segments[conversationSegment + 1];
    if (conversationSegment < 0 || !conversationId) {
      throw new Error("Open a ChatGPT conversation before saving it to AiSP.");
    }
    return { provider: "chatgpt", conversationId };
  }

  if (url.hostname === "claude.ai") {
    const chatSegment = segments.lastIndexOf("chat");
    const conversationId = segments[chatSegment + 1];
    if (chatSegment < 0 || !conversationId) {
      throw new Error("Open a Claude conversation before saving it to AiSP.");
    }
    return { provider: "claude", conversationId };
  }

  throw new Error("AiSP session saving currently supports ChatGPT and Claude only.");
}

export function matchesChatGptConversationRequest(
  request: ProviderRequest,
  target: ProviderConversationTarget,
): boolean {
  if (target.provider !== "chatgpt" || request.method.toUpperCase() !== "GET") {
    return false;
  }

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }

  if (url.hostname !== "chatgpt.com" && url.hostname !== "chat.openai.com") {
    return false;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  return (
    segments.length === 3 &&
    segments[0] === "backend-api" &&
    segments[1] === "conversations" &&
    segments[2] === target.conversationId
  );
}

export function matchesClaudeTimelineRequest(
  request: ProviderRequest,
  target?: ProviderConversationTarget,
): boolean {
  if (request.method.toUpperCase() !== "POST") return false;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }

  if (url.hostname !== "claude.ai") return false;

  const path = url.pathname.toLowerCase();
  const isConversationCompletion =
    path.includes("/chat_conversations/") &&
    (path.includes("/completion") || path.includes("streamtimeline"));
  const isStreamTimeline = url.href.toLowerCase().includes("streamtimeline");
  if (!isConversationCompletion && !isStreamTimeline) return false;
  if (!target) return true;

  const referer = getHeader(request.requestHeaders, "referer");
  const organizationId = getHeader(request.requestHeaders, "x-organization-uuid");
  if (!referer || !organizationId) return false;

  const requestChatMatch = url.pathname.match(/\/chat_conversations\/([^/]+)/i);
  if (
    requestChatMatch &&
    requestChatMatch[1] !== target.conversationId
  ) {
    return false;
  }

  try {
    const refererUrl = new URL(referer);
    if (refererUrl.hostname !== "claude.ai") return false;
    const segments = refererUrl.pathname.split("/").filter(Boolean);
    const chatSegment = segments.lastIndexOf("chat");
    return segments[chatSegment + 1] === target.conversationId;
  } catch {
    return false;
  }
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const entry = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name.toLowerCase(),
  );
  return entry?.[1];
}

export function buildClaudeConversationUrl(
  request: ProviderRequest,
  target: ProviderConversationTarget,
): string {
  if (target.provider !== "claude") {
    throw new Error("Claude conversation details can only be built for Claude captures.");
  }

  const organizationId = getHeader(request.requestHeaders, "x-organization-uuid");
  const referer = getHeader(request.requestHeaders, "referer");
  if (!organizationId) {
    throw new Error("The captured Claude request did not include x-organization-uuid.");
  }
  if (!referer) {
    throw new Error("The captured Claude request did not include a Referer header.");
  }

  const refererUrl = new URL(referer);
  if (refererUrl.hostname !== "claude.ai") {
    throw new Error("The captured Claude request has an unexpected Referer host.");
  }

  const segments = refererUrl.pathname.split("/").filter(Boolean);
  const chatSegment = segments.lastIndexOf("chat");
  const conversationId = segments[chatSegment + 1];
  if (!conversationId || conversationId !== target.conversationId) {
    throw new Error("The captured Claude request belongs to a different conversation.");
  }

  const query = new URLSearchParams({
    tree: "True",
    rendering_mode: "messages",
    render_all_tools: "true",
    include_inline_comparison: "true",
    consistency: "strong",
  });

  return (
    `https://claude.ai/api/organizations/${encodeURIComponent(organizationId)}` +
    `/chat_conversations/${encodeURIComponent(conversationId)}?${query.toString()}`
  );
}

export function parseProviderConversation(
  target: ProviderConversationTarget,
  rawBody: string,
): Record<string, unknown> {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    throw new Error(
      `The ${target.provider} conversation response was not valid JSON: ${String(error)}`,
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`The ${target.provider} conversation response was not a JSON object.`);
  }

  const conversation = payload as Record<string, unknown>;
  const responseId =
    target.provider === "chatgpt" ? conversation.conversation_id : conversation.uuid;

  if (typeof responseId !== "string" || responseId !== target.conversationId) {
    throw new Error(
      `The ${target.provider} response did not match the conversation open in this tab.`,
    );
  }

  if (
    target.provider === "chatgpt" &&
    !Array.isArray(conversation.messages)
  ) {
    throw new Error("The ChatGPT conversation response did not contain a messages array.");
  }
  if (
    target.provider === "claude" &&
    !Array.isArray(conversation.chat_messages)
  ) {
    throw new Error("The Claude conversation response did not contain chat_messages.");
  }

  return conversation;
}
