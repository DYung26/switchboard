import type { BackgroundService } from "../background-service";
import type {
  MessageBus,
  NetworkReplayResult,
  NetworkRequest,
  SavedNetworkRequest,
} from "@/types";
import { MESSAGE_TYPE } from "@/constants/messages";
import { AISP_SESSION_SETTINGS_KEY } from "@/constants/app";
import { createChromeStorageService } from "@/storage";
import {
  buildClaudeConversationUrl,
  identifyProviderConversation,
  matchesChatGptConversationRequest,
  matchesClaudeTimelineRequest,
  parseProviderConversation,
  type AiSPProvider,
  type CapturedProviderConversation,
  type ProviderConversationTarget,
} from "./session-capture";

const SAVED_REQUESTS_KEY = "network:saved-requests";
const SESSION_CAPTURE_TIMEOUT_MS = 60_000;
const DEBUGGER_VERSION = "1.3";
const SESSION_SAVE_BADGES = {
  saving: { text: "...", color: "#2563eb" },
  saved: { text: "OK", color: "#16a34a" },
  error: { text: "ERR", color: "#dc2626" },
} as const;

async function updateSessionSaveBadge(
  status: keyof typeof SESSION_SAVE_BADGES,
): Promise<void> {
  const badge = SESSION_SAVE_BADGES[status];
  await Promise.all([
    chrome.action.setBadgeText({ text: badge.text }),
    chrome.action.setBadgeBackgroundColor({ color: badge.color }),
    chrome.action.setTitle({
      title:
        status === "saving"
          ? "Switchboard: saving session to AiSP"
          : status === "saved"
            ? "Switchboard: session saved to AiSP"
            : "Switchboard: session save failed; reopen for details",
    }),
  ]);
}

interface RequestWillBeSent {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    postData?: string;
  };
}

interface RequestWillBeSentExtraInfo {
  requestId: string;
  headers: Record<string, string>;
}

interface ResponseReceived {
  requestId: string;
  response: {
    status: number;
    headers: Record<string, string>;
    mimeType?: string;
  };
}

interface LoadingFinished {
  requestId: string;
}

interface LoadingFailed {
  requestId: string;
  errorText: string;
}

interface PendingSessionCapture {
  target: ProviderConversationTarget;
  resolve: (request: NetworkRequest) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface AiSPSessionSettings {
  bridgeUrl: string;
  token: string;
  project: string;
  task: string;
}

interface AiSPImportResult {
  session_id: string;
  title?: string | null;
  events: number;
  path: string;
}

export function createNetworkService(bus: MessageBus): BackgroundService {
  const captured = new Map<string, NetworkRequest>();
  const extraRequestHeaders = new Map<string, Record<string, string>>();
  const storage = createChromeStorageService();
  let attachedTabId: number | undefined;
  let lastWebTabId: number | undefined;
  let pendingSessionCapture: PendingSessionCapture | undefined;

  function debuggee(tabId: number): chrome.debugger.Debuggee {
    return { tabId };
  }

  async function detach(): Promise<void> {
    if (attachedTabId === undefined) return;
    const tabId = attachedTabId;
    attachedTabId = undefined;
    try {
      await chrome.debugger.detach(debuggee(tabId));
    } catch {
      // The tab may have been closed or the debugger may already be detached.
    }
  }

  async function startCapture(
    tabId?: number,
    options: { url?: string; reload?: boolean } = {},
  ): Promise<void> {
    let targetTabId = tabId;
    let createdTarget = false;

    if (options.url !== undefined) {
      await chrome.tabs.create({ url: "about:blank", active: true });
      const [created] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (created?.id === undefined) {
        throw new Error("Network capture could not identify the target tab.");
      }
      targetTabId = created.id;
      createdTarget = true;
    } else if (targetTabId === undefined) {
      const tabs = await chrome.tabs.query({});
      const webTabs = tabs
        .filter(
          (tab) =>
            typeof tab.id === "number" &&
            Number.isInteger(tab.id) &&
            tab.id > 0 &&
            /^https?:/i.test(tab.url ?? ""),
        )
        .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
      targetTabId = webTabs[0]?.id ?? lastWebTabId;
    }

    if (targetTabId === undefined) {
      throw new Error("Network capture requires an active browser tab.");
    }
    targetTabId = Number(targetTabId);
    if (!Number.isInteger(targetTabId) || targetTabId <= 0) {
      throw new Error("Network capture target tab ID is invalid.");
    }

    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.id === targetTabId);
    const url = tab?.url ?? "";
    if (!createdTarget) {
      if (/^(chrome|edge|about|devtools):/i.test(url)) {
        throw new Error(`Cannot capture browser-internal URL: ${url}`);
      }
      if (!/^https?:/i.test(url)) {
        throw new Error(`Cannot capture unsupported URL: ${url || "unknown"}`);
      }
    }

    if (attachedTabId !== undefined && attachedTabId !== targetTabId) {
      await detach();
    }
    if (attachedTabId === targetTabId) {
      captured.clear();
      extraRequestHeaders.clear();
    } else {
      try {
        await chrome.debugger.attach(debuggee(targetTabId), DEBUGGER_VERSION);
        await chrome.debugger.sendCommand(
          debuggee(targetTabId),
          "Network.enable",
        );
      } catch (error) {
        throw new Error(
          `Network capture could not attach to tab ${targetTabId}: ${error}`,
        );
      }
      attachedTabId = targetTabId;
      captured.clear();
      extraRequestHeaders.clear();
    }

    if (createdTarget) {
      await chrome.tabs.update(targetTabId, { url: options.url! });
      await waitForTabLoad(targetTabId);
    } else if (options.reload) {
      await chrome.tabs.reload(targetTabId);
      await waitForTabLoad(targetTabId);
    }
  }

  async function stopCapture(): Promise<void> {
    await detach();
    extraRequestHeaders.clear();
  }

  async function listCaptured(): Promise<NetworkRequest[]> {
    return [...captured.values()].sort((a, b) => b.capturedAt - a.capturedAt);
  }

  async function listSaved(): Promise<SavedNetworkRequest[]> {
    return (await storage.get<SavedNetworkRequest[]>(SAVED_REQUESTS_KEY)) ?? [];
  }

  async function saveRequest(
    request: NetworkRequest,
    name: string,
  ): Promise<SavedNetworkRequest> {
    const now = Date.now();
    const saved: SavedNetworkRequest = {
      id: crypto.randomUUID(),
      name: name.trim() || new URL(request.url).pathname || request.url,
      url: request.url,
      method: request.method,
      requestHeaders: request.requestHeaders,
      createdAt: now,
      updatedAt: now,
      ...(request.requestBody !== undefined
        ? { requestBody: request.requestBody }
        : {}),
    };
    const existing = await listSaved();
    await storage.set(SAVED_REQUESTS_KEY, [saved, ...existing]);
    return saved;
  }

  async function deleteSaved(id: string): Promise<void> {
    const existing = await listSaved();
    await storage.set(
      SAVED_REQUESTS_KEY,
      existing.filter((request) => request.id !== id),
    );
  }

  async function updateSaved(
    id: string,
    patch: Pick<SavedNetworkRequest, "name" | "url" | "method" | "requestHeaders" | "requestBody">,
  ): Promise<SavedNetworkRequest> {
    const existing = await listSaved();
    const index = existing.findIndex((request) => request.id === id);
    if (index < 0) throw new Error('Saved request "' + id + '" not found.');

    const current = existing[index]!;
    const updated: SavedNetworkRequest = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    existing[index] = updated;
    await storage.set(SAVED_REQUESTS_KEY, existing);
    return updated;
  }

  async function waitForTabLoad(tabId: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error): void => {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        if (error) reject(error);
        else resolve();
      };
      const listener = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
      ): void => {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          finish();
        }
      };
      const timeout = setTimeout(
        () => finish(new Error("Browser target tab did not finish loading.")),
        30_000,
      );
      chrome.tabs.onUpdated.addListener(listener);
      void chrome.tabs
        .get(tabId)
        .then((tab) => {
          if (tab.status === "complete") finish();
        })
        .catch((error: unknown) =>
          finish(new Error(`Could not inspect browser tab: ${String(error)}`)),
        );
    });
  }

  function resolvePendingSessionCapture(
    request: NetworkRequest,
    stage: "request" | "response",
  ): void {
    const pending = pendingSessionCapture;
    if (!pending) return;

    if (pending.target.provider === "claude") {
      if (stage !== "request" || !matchesClaudeTimelineRequest(request, pending.target)) {
        return;
      }
    } else {
      if (
        stage !== "response" ||
        !matchesChatGptConversationRequest(request, pending.target)
      ) {
        return;
      }
      if (request.responseBodyError) {
        clearTimeout(pending.timeout);
        pendingSessionCapture = undefined;
        pending.reject(new Error(request.responseBodyError));
        return;
      }
      if (request.responseBody === undefined) return;
    }

    clearTimeout(pending.timeout);
    pendingSessionCapture = undefined;
    pending.resolve(request);
  }

  async function waitForSessionRequest(
    target: ProviderConversationTarget,
  ): Promise<NetworkRequest> {
    const existing = [...captured.values()].find((request) => {
      if (target.provider === "claude") {
        return matchesClaudeTimelineRequest(request, target);
      }
      return (
        matchesChatGptConversationRequest(request, target) &&
        (request.responseBody !== undefined || request.responseBodyError !== undefined)
      );
    });
    if (existing) {
      if (existing.responseBodyError) throw new Error(existing.responseBodyError);
      return existing;
    }

    if (pendingSessionCapture) {
      throw new Error("Another AiSP session capture is already running.");
    }

    return new Promise<NetworkRequest>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingSessionCapture = undefined;
        reject(
          new Error(
            `Timed out waiting for the ${target.provider} conversation response. Reload the chat and try again.`,
          ),
        );
      }, SESSION_CAPTURE_TIMEOUT_MS);

      pendingSessionCapture = { target, resolve, reject, timeout };

      // A request may have arrived while the tab finished loading.
      for (const request of captured.values()) {
        resolvePendingSessionCapture(
          request,
          target.provider === "claude" ? "request" : "response",
        );
        if (!pendingSessionCapture) break;
      }
    });
  }

  async function captureProviderSession(
    tabId: number,
  ): Promise<CapturedProviderConversation> {
    if (attachedTabId !== undefined && attachedTabId !== tabId) {
      throw new Error(
        "Stop the existing Network capture before saving a session from another tab.",
      );
    }

    const tab = await chrome.tabs.get(tabId);
    const target = identifyProviderConversation(tab.url ?? "");

    try {
      await startCapture(tabId, { reload: true });
      const request = await waitForSessionRequest(target);
      let rawBody: string;

      if (target.provider === "claude") {
        const detailUrl = buildClaudeConversationUrl(request, target);
        const response = await fetchUrl(detailUrl, "GET", {}, tabId);
        if (response.status < 200 || response.status >= 300) {
          throw new Error(
            `Claude conversation fetch failed with HTTP ${response.status}.`,
          );
        }
        rawBody = response.body;
      } else {
        if (request.status === undefined || request.status < 200 || request.status >= 300) {
          throw new Error(
            `ChatGPT conversation request failed with HTTP ${request.status ?? "unknown"}.`,
          );
        }
        if (request.responseBody === undefined) {
          throw new Error("ChatGPT did not return a readable conversation response body.");
        }
        rawBody = request.responseBody;
      }

      return {
        provider: target.provider,
        conversationId: target.conversationId,
        conversation: parseProviderConversation(target, rawBody),
      };
    } finally {
      if (pendingSessionCapture) {
        clearTimeout(pendingSessionCapture.timeout);
        pendingSessionCapture = undefined;
      }
      await stopCapture();
    }
  }

  async function saveProviderSession(
    tabId: number,
    expectedProvider: AiSPProvider,
    expectedConversationId: string,
  ): Promise<AiSPImportResult> {
    const activeTab = await chrome.tabs.get(tabId);
    const activeTarget = identifyProviderConversation(activeTab.url ?? "");
    if (
      activeTarget.provider !== expectedProvider ||
      activeTarget.conversationId !== expectedConversationId
    ) {
      throw new Error("The active conversation changed before capture started. Try again.");
    }

    const settings = await storage.get<AiSPSessionSettings>(AISP_SESSION_SETTINGS_KEY);
    if (!settings?.token?.trim()) throw new Error("Enter the AiSP bridge token in Settings.");
    if (!settings.project?.trim()) throw new Error("Enter the AiSP project name in Settings.");
    if (!settings.task?.trim()) throw new Error("Enter the AiSP task name in Settings.");

    let bridgeUrl: URL;
    try {
      bridgeUrl = new URL(settings.bridgeUrl.trim());
    } catch {
      throw new Error("The AiSP bridge URL is invalid.");
    }
    if (
      (bridgeUrl.protocol !== "http:" && bridgeUrl.protocol !== "https:") ||
      bridgeUrl.username ||
      bridgeUrl.password ||
      bridgeUrl.search ||
      bridgeUrl.hash ||
      (bridgeUrl.pathname !== "/" && bridgeUrl.pathname !== "")
    ) {
      throw new Error("The AiSP bridge URL must be an HTTP(S) origin without a path or credentials.");
    }

    try {
      await updateSessionSaveBadge("saving");

      const healthResponse = await fetch(`${bridgeUrl.origin}/health`, {
        headers: {
          Authorization: `Bearer ${settings.token.trim()}`,
        },
      });
      if (!healthResponse.ok) {
        if (healthResponse.status === 401) {
          throw new Error("AiSP bridge rejected the token. Check the saved bridge token.");
        }
        throw new Error(`AiSP bridge health check failed with HTTP ${healthResponse.status}.`);
      }
      const health = (await healthResponse.json()) as { providers?: string[] };
      if (!health.providers?.includes(expectedProvider)) {
        throw new Error(`The AiSP bridge does not support ${expectedProvider}.`);
      }

      const capture = await captureProviderSession(tabId);
      if (
        capture.provider !== expectedProvider ||
        capture.conversationId !== expectedConversationId
      ) {
        throw new Error("The captured conversation changed during page reload. Try again.");
      }

      const response = await fetch(`${bridgeUrl.origin}/api/sessions/import`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.token.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: capture.provider,
          project: settings.project.trim(),
          task: settings.task.trim(),
          conversation: capture.conversation,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as
        | AiSPImportResult
        | { error?: string };
      if (!response.ok) {
        const error = "error" in payload ? payload.error : undefined;
        throw new Error(error || `AiSP bridge returned HTTP ${response.status}.`);
      }

      await updateSessionSaveBadge("saved");
      return payload as AiSPImportResult;
    } catch (error) {
      await updateSessionSaveBadge("error");
      throw error;
    }
  }

  async function fetchUrl(
    url: string,
    method = "GET",
    headers: Record<string, string> = {},
    preferredTabId?: number,
  ): Promise<NetworkReplayResult> {
    const parsedUrl = new URL(url);
    const targetOrigin = parsedUrl.origin;
    const tabs = await chrome.tabs.query({});
    const targetTab = tabs.find((tab) => {
      if (preferredTabId !== undefined && tab.id !== preferredTabId) return false;
      try {
        return new URL(tab.url ?? "").origin === targetOrigin;
      } catch {
        return false;
      }
    });
    if (preferredTabId !== undefined && targetTab?.id === undefined) {
      throw new Error("The original provider tab is no longer available for the conversation fetch.");
    }
    let targetTabId = targetTab?.id;
    let createdTabId: number | undefined;
    if (targetTabId === undefined) {
      const created = await chrome.tabs.create({ url: targetOrigin, active: false });
      if (created.id === undefined) throw new Error("Browser fetch could not create a target tab.");
      targetTabId = created.id;
      createdTabId = created.id;
      await waitForTabLoad(createdTabId);
    }
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
      world: "MAIN",
      func: async (input) => {
        const requestHeaders = new Headers();
        for (const [name, value] of Object.entries(input.headers)) {
          try { requestHeaders.set(name, value); } catch { /* browser-controlled */ }
        }
        const response = await fetch(input.url, {
          method: input.method,
          headers: requestHeaders,
          credentials: "include",
        });
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text(),
        };
      },
      args: [{ url, method, headers }],
    });
      const result = results[0]?.result as NetworkReplayResult | undefined;
      if (!result) throw new Error("Network fetch returned no response.");
      return result;
    } finally {
      if (createdTabId !== undefined) {
        await chrome.tabs.remove(createdTabId).catch(() => undefined);
      }
    }
  }

  async function replay(
    request: SavedNetworkRequest,
    tabId: number,
    sets: Array<{ path: string; value: string }> = [],
    replacements: Record<string, string> = {},
    urlOverride?: string,
    methodOverride?: string,
    headersOverride?: Record<string, string>,
  ): Promise<NetworkReplayResult> {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async (input) => {
        const getPath = (
          root: unknown,
          path: string,
        ): { parent: Record<string, unknown>; key: string } => {
          const parts = path.split(".").filter(Boolean);
          if (parts.length === 0) throw new Error("Replacement path cannot be empty.");
          let parent: unknown = root;
          for (const part of parts.slice(0, -1)) {
            if (parent === null || typeof parent !== "object" || !(part in parent)) {
              throw new Error("Replacement path not found: " + path);
            }
            parent = (parent as Record<string, unknown>)[part];
          }
          if (parent === null || typeof parent !== "object") {
            throw new Error("Replacement path not found: " + path);
          }
          return {
            parent: parent as Record<string, unknown>,
            key: parts[parts.length - 1]!,
          };
        };

        const setJsonPath = (root: unknown, path: string, value: string): void => {
          const { parent, key } = getPath(root, path);
          if (parent === null || typeof parent !== "object" || !(key in parent)) {
            throw new Error("Replacement path not found: " + path);
          }
          parent[key] = value;
        };

        const headers = { ...input.headers };
        let body = input.body;

        for (const set of input.sets) {
          if (set.path === "url.pathname") {
            const parsed = new URL(input.url);
            parsed.pathname = set.value;
            input.url = parsed.toString();
            continue;
          }
          if (set.path.startsWith("url.path.")) {
            const index = Number(set.path.slice("url.path.".length));
            if (!Number.isInteger(index) || index < 0) {
              throw new Error("Invalid URL path index: " + set.path);
            }
            const parsed = new URL(input.url);
            const segments = parsed.pathname.split("/");
            if (index >= segments.length) {
              throw new Error("URL path index not found: " + set.path);
            }
            segments[index] = set.value;
            parsed.pathname = segments.join("/");
            input.url = parsed.toString();
            continue;
          }
          if (set.path.startsWith("url.query.")) {
            const key = set.path.slice("url.query.".length);
            const parsed = new URL(input.url);
            if (!parsed.searchParams.has(key)) throw new Error("URL query parameter not found: " + key);
            parsed.searchParams.set(key, set.value);
            input.url = parsed.toString();
            continue;
          }
          if (set.path.startsWith("headers.")) {
            const requested = set.path.slice("headers.".length);
            const actual = Object.keys(headers).find(
              (name) => name.toLowerCase() === requested.toLowerCase(),
            );
            if (!actual) throw new Error("Header path not found: " + requested);
            headers[actual] = set.value;
            continue;
          }
          if (!set.path.startsWith("body.")) {
            throw new Error("Unsupported replacement path: " + set.path);
          }
          if (body === undefined) throw new Error("Request has no body: " + set.path);
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            throw new Error("Request body is not JSON; cannot use path: " + set.path);
          }
          setJsonPath(parsed, set.path.slice("body.".length), set.value);
          body = JSON.stringify(parsed);
        }

        const rawReplace = (value: string): string =>
          Object.entries(input.replacements).reduce(
            (current, [from, to]) => current.split(from).join(to),
            value,
          );

        const finalUrl = rawReplace(input.url);
        const finalHeaders = Object.fromEntries(
          Object.entries(headers).map(([name, value]) => [name, rawReplace(value)]),
        );
        const finalBody = body === undefined ? undefined : rawReplace(body);
        const requestHeaders = new Headers();
        for (const [name, value] of Object.entries(finalHeaders)) {
          try { requestHeaders.set(name, value); } catch { /* browser-controlled */ }
        }

        const response = await fetch(finalUrl, {
          method: input.method,
          headers: requestHeaders,
          credentials: "include",
          ...(finalBody !== undefined ? { body: finalBody } : {}),
        });
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text(),
        };
      },
      args: [{
        url: urlOverride ?? request.url,
        method: methodOverride ?? request.method,
        headers: headersOverride ?? request.requestHeaders,
        body: request.requestBody,
        sets,
        replacements,
      }],
    });
    const result = results[0]?.result as NetworkReplayResult | undefined;
    if (!result) throw new Error("Replay returned no response.");
    return result;
  }

  return {
    name: "network",

    init(): void {
      void chrome.tabs
        .query({ active: true, lastFocusedWindow: true })
        .then((tabs) => {
          const tab = tabs[0];
          if (tab && tab.id !== undefined && /^https?:/i.test(tab.url ?? "")) {
            lastWebTabId = tab.id;
          }
        });

      chrome.tabs.onActivated.addListener(({ tabId }) => {
        void chrome.tabs.query({}).then((tabs) => {
          const tab = tabs.find((candidate) => candidate.id === tabId);
          if (tab && /^https?:/i.test(tab.url ?? "")) {
            lastWebTabId = tabId;
          }
        }).catch(() => undefined);
      });

      chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (
          tab.active &&
          (changeInfo.url !== undefined || tab.url !== undefined) &&
          /^https?:/i.test(tab.url ?? "")
        ) {
          lastWebTabId = tabId;
        }
      });

      chrome.debugger.onEvent.addListener((source, method, params) => {
        if (source.tabId === undefined || source.tabId !== attachedTabId) return;

        if (method === "Network.requestWillBeSent") {
          const event = params as RequestWillBeSent;
          const request: NetworkRequest = {
            id: event.requestId,
            tabId: source.tabId,
            url: event.request.url,
            method: event.request.method,
            requestHeaders: {
              ...event.request.headers,
              ...(extraRequestHeaders.get(event.requestId) ?? {}),
            },
            capturedAt: Date.now(),
            ...(event.request.postData !== undefined
              ? { requestBody: event.request.postData }
              : {}),
          };
          extraRequestHeaders.delete(event.requestId);
          captured.set(event.requestId, request);
          resolvePendingSessionCapture(request, "request");
          return;
        }

        if (method === "Network.requestWillBeSentExtraInfo") {
          const event = params as RequestWillBeSentExtraInfo;
          const request = captured.get(event.requestId);
          if (request) {
            request.requestHeaders = {
              ...request.requestHeaders,
              ...event.headers,
            };
            resolvePendingSessionCapture(request, "request");
          } else {
            extraRequestHeaders.set(event.requestId, event.headers);
          }
          return;
        }

        if (method === "Network.responseReceived") {
          const event = params as ResponseReceived;
          const request = captured.get(event.requestId);
          if (!request) return;
          request.status = event.response.status;
          request.responseHeaders = event.response.headers;
          if (event.response.mimeType !== undefined) {
            request.mimeType = event.response.mimeType;
          }
          return;
        }

        if (method === "Network.loadingFinished") {
          const event = params as LoadingFinished;
          const request = captured.get(event.requestId);
          if (!request) return;
          request.loadingFinished = true;

          void chrome.debugger
            .sendCommand(source, "Network.getResponseBody", {
              requestId: event.requestId,
            })
            .then((body) => {
              const payload = body as {
                body?: string;
                base64Encoded?: boolean;
              };
              if (payload.body === undefined) {
                request.responseBodyError = "The provider response body was empty or unavailable.";
              } else if (payload.base64Encoded) {
                const binary = atob(payload.body);
                const bytes = Uint8Array.from(binary, (character) =>
                  character.charCodeAt(0),
                );
                request.responseBody = new TextDecoder().decode(bytes);
              } else {
                request.responseBody = payload.body;
              }
              resolvePendingSessionCapture(request, "response");
            })
            .catch((error: unknown) => {
              request.responseBodyError =
                `Could not retrieve provider response body: ${String(error)}`;
              resolvePendingSessionCapture(request, "response");
            });
          return;
        }

        if (method === "Network.loadingFailed") {
          const event = params as LoadingFailed;
          const request = captured.get(event.requestId);
          if (!request) return;
          request.loadingFinished = true;
          request.responseBodyError = `Provider request failed: ${event.errorText}`;
          resolvePendingSessionCapture(request, "response");
        }
      });

      chrome.debugger.onDetach.addListener((source) => {
        if (source.tabId === attachedTabId) {
          attachedTabId = undefined;
        }
      });

      bus.on<
        { tabId?: number; target?: "active"; url?: string; reload?: boolean },
        void
      >(
        MESSAGE_TYPE.NETWORK_CAPTURE_START,
        ({ tabId, target, url, reload }) =>
          startCapture(
            target === "active" ? undefined : tabId,
            {
              ...(url !== undefined ? { url } : {}),
              ...(reload !== undefined ? { reload } : {}),
            },
          ),
      );
      bus.on<void, void>(MESSAGE_TYPE.NETWORK_CAPTURE_STOP, () => stopCapture());
      bus.on<{
        tabId: number;
        provider: AiSPProvider;
        conversationId: string;
      }, AiSPImportResult>(
        MESSAGE_TYPE.NETWORK_SESSION_SAVE,
        ({ tabId, provider, conversationId }) =>
          saveProviderSession(tabId, provider, conversationId),
      );
      bus.on<void, NetworkRequest[]>(
        MESSAGE_TYPE.NETWORK_CAPTURE_LIST,
        () => listCaptured(),
      );
      bus.on<void, { captured: NetworkRequest[]; saved: SavedNetworkRequest[] }>(
        MESSAGE_TYPE.NETWORK_LIST,
        async () => ({
          captured: await listCaptured(),
          saved: await listSaved(),
        }),
      );
      bus.on<
        { id: string },
        { kind: "captured"; request: NetworkRequest } | { kind: "saved"; request: SavedNetworkRequest }
      >(MESSAGE_TYPE.NETWORK_GET, async ({ id }) => {
        const capturedRequest = captured.get(id);
        if (capturedRequest) return { kind: "captured", request: capturedRequest };

        const savedRequest = (await listSaved()).find((item) => item.id === id);
        if (savedRequest) return { kind: "saved", request: savedRequest };

        throw new Error('Network request "' + id + '" not found.');
      });
      bus.on<{ requestId: string; name: string }, SavedNetworkRequest>(
        MESSAGE_TYPE.NETWORK_SAVE,
        async ({ requestId, name }) => {
          const request = captured.get(requestId);
          if (!request) {
            throw new Error(
              'Captured request "' + requestId + '" no longer exists.',
            );
          }
          return saveRequest(request, name);
        },
      );
      bus.on<{ id: string }, void>(
        MESSAGE_TYPE.NETWORK_DELETE,
        ({ id }) => deleteSaved(id),
      );
      bus.on<{
        url: string;
        method?: string;
        headers?: Record<string, string>;
        tabId?: number;
      }, NetworkReplayResult>(
        MESSAGE_TYPE.NETWORK_FETCH,
        ({ url, method, headers, tabId }) => fetchUrl(url, method, headers, tabId),
      );
      bus.on<void, SavedNetworkRequest[]>(
        MESSAGE_TYPE.NETWORK_SAVED_LIST,
        () => listSaved(),
      );
      bus.on<{ id: string }, SavedNetworkRequest>(
        MESSAGE_TYPE.NETWORK_SAVED_GET,
        async ({ id }) => {
          const request = (await listSaved()).find((item) => item.id === id);
          if (!request) throw new Error('Saved request "' + id + '" not found.');
          return request;
        },
      );
      bus.on<{ requestId: string; name: string }, SavedNetworkRequest>(
        MESSAGE_TYPE.NETWORK_SAVED_SAVE,
        async ({ requestId, name }) => {
          const request = captured.get(requestId);
          if (!request) {
            throw new Error(
              'Captured request "' + requestId + '" no longer exists.',
            );
          }
          return saveRequest(request, name);
        },
      );
      bus.on<{ id: string }, void>(
        MESSAGE_TYPE.NETWORK_SAVED_DELETE,
        ({ id }) => deleteSaved(id),
      );
      bus.on<
        {
          id: string;
          name: string;
          url: string;
          method: string;
          requestHeaders: Record<string, string>;
          requestBody?: string;
        },
        SavedNetworkRequest
      >(MESSAGE_TYPE.NETWORK_SAVED_UPDATE, (payload) =>
        updateSaved(payload.id, payload),
      );
      bus.on<
        {
          id: string;
          tabId?: number;
          target?: "active";
          sets?: Array<{ path: string; value: string }>;
          replacements?: Record<string, string>;
          url?: string;
          method?: string;
          headers?: Record<string, string>;
        },
        NetworkReplayResult
      >(MESSAGE_TYPE.NETWORK_REPLAY, async ({ id, tabId, target, sets, replacements, url, method, headers }, sender) => {
        const request = (await listSaved()).find((item) => item.id === id);
        if (!request) {
          throw new Error('Saved request "' + id + '" not found.');
        }

        let targetTabId = tabId ?? sender.tab?.id;
        if (target === "active" || targetTabId === undefined) {
          targetTabId = lastWebTabId;
        }

        let createdTabId: number | undefined;
        if (targetTabId === undefined && url !== undefined) {
          const created = await chrome.tabs.create({ url: new URL(url).origin, active: false });
          if (created.id === undefined) {
            throw new Error("Network replay could not create a target tab.");
          }
          targetTabId = created.id;
          createdTabId = created.id;
          await waitForTabLoad(createdTabId);
        }

        if (targetTabId === undefined) {
          throw new Error("Network replay requires an active browser tab.");
        }

        try {
          return await replay(request, targetTabId, sets, replacements, url, method, headers);
        } finally {
          if (createdTabId !== undefined) {
            await chrome.tabs.remove(createdTabId).catch(() => undefined);
          }
        }
      });
    },
  };
}
