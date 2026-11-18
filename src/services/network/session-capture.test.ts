import { describe, expect, it } from "vitest";
import {
  buildClaudeConversationUrl,
  identifyProviderConversation,
  matchesChatGptConversationRequest,
  matchesClaudeTimelineRequest,
  parseProviderConversation,
} from "./session-capture";

describe("identifyProviderConversation", () => {
  it("recognizes ChatGPT conversation routes, including GPT project routes", () => {
    expect(
      identifyProviderConversation("https://chatgpt.com/g/g-123/c/chat-456"),
    ).toEqual({ provider: "chatgpt", conversationId: "chat-456" });
  });

  it("recognizes Claude chat routes", () => {
    expect(
      identifyProviderConversation("https://claude.ai/chat/claude-123"),
    ).toEqual({ provider: "claude", conversationId: "claude-123" });
  });

  it("rejects provider home pages and unsupported hosts", () => {
    expect(() => identifyProviderConversation("https://chatgpt.com/")).toThrow(
      "Open a ChatGPT conversation",
    );
    expect(() => identifyProviderConversation("https://example.com/chat/123")).toThrow(
      "supports ChatGPT and Claude only",
    );
  });
});

describe("provider request matching", () => {
  const chatgptTarget = { provider: "chatgpt" as const, conversationId: "chat-123" };

  it("matches only the target ChatGPT conversation detail GET", () => {
    expect(
      matchesChatGptConversationRequest(
        {
          url: "https://chatgpt.com/backend-api/conversations/chat-123?offset=0",
          method: "GET",
          requestHeaders: {},
        },
        chatgptTarget,
      ),
    ).toBe(true);
    expect(
      matchesChatGptConversationRequest(
        {
          url: "https://chatgpt.com/backend-api/conversations/other",
          method: "GET",
          requestHeaders: {},
        },
        chatgptTarget,
      ),
    ).toBe(false);
  });

  it("matches the Claude stream request to the active conversation", () => {
    const request = {
      url: "https://claude.ai/api/organizations/org-1/chat_conversations/chat-1/completion",
      method: "POST",
      requestHeaders: {
        "x-organization-uuid": "org-1",
        Referer: "https://claude.ai/chat/chat-1",
      },
    };

    expect(
      matchesClaudeTimelineRequest(request, {
        provider: "claude",
        conversationId: "chat-1",
      }),
    ).toBe(true);
    expect(
      matchesClaudeTimelineRequest(request, {
        provider: "claude",
        conversationId: "another-chat",
      }),
    ).toBe(false);
  });

  it("builds the finite Claude conversation detail URL from captured headers", () => {
    const url = buildClaudeConversationUrl(
      {
        url: "https://claude.ai/api/organizations/org-1/chat_conversations/chat-1/completion",
        method: "POST",
        requestHeaders: {
          "X-Organization-UUID": "org-1",
          Referer: "https://claude.ai/chat/chat-1",
        },
      },
      { provider: "claude", conversationId: "chat-1" },
    );

    expect(url).toContain("/api/organizations/org-1/chat_conversations/chat-1?");
    expect(url).toContain("rendering_mode=messages");
    expect(url).toContain("consistency=strong");
  });
});

describe("parseProviderConversation", () => {
  it("validates the returned ChatGPT conversation ID and message array", () => {
    expect(
      parseProviderConversation(
        { provider: "chatgpt", conversationId: "chat-1" },
        JSON.stringify({ conversation_id: "chat-1", messages: [] }),
      ),
    ).toEqual({ conversation_id: "chat-1", messages: [] });
  });

  it("rejects a response for a different conversation", () => {
    expect(() =>
      parseProviderConversation(
        { provider: "claude", conversationId: "chat-1" },
        JSON.stringify({ uuid: "chat-2", chat_messages: [] }),
      ),
    ).toThrow("did not match the conversation");
  });
});
