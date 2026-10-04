import type { BackgroundService } from "../background-service";
import type {
  MessageBus,
  NetworkReplayResult,
  NetworkRequest,
  SavedNetworkRequest,
} from "@/types";
import { MESSAGE_TYPE } from "@/constants/messages";
import { createChromeStorageService } from "@/storage";

const SAVED_REQUESTS_KEY = "network:saved-requests";
const DEBUGGER_VERSION = "1.3";

interface RequestWillBeSent {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    postData?: string;
  };
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

export function createNetworkService(bus: MessageBus): BackgroundService {
  const captured = new Map<string, NetworkRequest>();
  const storage = createChromeStorageService();
  let attachedTabId: number | undefined;
  let lastWebTabId: number | undefined;

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
    }

    if (createdTarget) {
      await chrome.tabs.update(targetTabId, { url: options.url! });
      await waitForTabLoad(targetTabId);
    } else if (options.reload) {
      await chrome.tabs.reload(targetTabId);
      await waitForTabLoad(targetTabId);
    }
  }

  async function waitForTabLoad(tabId: number): Promise<void> {
    const tab = (await chrome.tabs.query({})).find(
      (candidate) => candidate.id === tabId,
    );
    if (tab?.status === "complete") return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Browser target tab did not finish loading."));
      }, 15000);
      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async function stopCapture(): Promise<void> {
    await detach();
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

  async function fetchUrl(
    url: string,
    method = "GET",
    headers: Record<string, string> = {},
  ): Promise<NetworkReplayResult> {
    const parsedUrl = new URL(url);
    const targetOrigin = parsedUrl.origin;
    const tabs = await chrome.tabs.query({});
    const targetTab = tabs.find((tab) => {
      try {
        return new URL(tab.url ?? "").origin === targetOrigin;
      } catch {
        return false;
      }
    });
    let targetTabId = targetTab?.id;
    let createdTabId: number | undefined;
    if (targetTabId === undefined) {
      const created = await chrome.tabs.create({ url, active: false });
      if (created.id === undefined) throw new Error("Browser fetch could not create a target tab.");
      targetTabId = created.id;
      createdTabId = created.id;
      await new Promise<void>((resolve, reject) => {
        const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
          if (tabId !== createdTabId || changeInfo.status !== "complete") return;
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
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
        const getPath = (root: unknown, path: string): { parent: any; key: string } => {
          const parts = path.split(".").filter(Boolean);
          if (parts.length === 0) throw new Error("Replacement path cannot be empty.");
          let parent: any = root;
          for (const part of parts.slice(0, -1)) {
            if (parent === null || typeof parent !== "object" || !(part in parent)) {
              throw new Error("Replacement path not found: " + path);
            }
            parent = parent[part];
          }
          return { parent, key: parts[parts.length - 1]! };
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
          let parsed: any;
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
          captured.set(event.requestId, {
            id: event.requestId,
            tabId: source.tabId,
            url: event.request.url,
            method: event.request.method,
            requestHeaders: event.request.headers,
            capturedAt: Date.now(),
            ...(event.request.postData !== undefined
              ? { requestBody: event.request.postData }
              : {}),
          });
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

          void chrome.debugger
            .sendCommand(source, "Network.getResponseBody", {
              requestId: event.requestId,
            })
            .then((body) => {
              const payload = body as {
                body?: string;
                base64Encoded?: boolean;
              };
              if (payload.body !== undefined) {
                const responseBody = payload.base64Encoded
                  ? atob(payload.body)
                  : payload.body;
                request.responseBody = responseBody;
              }
            })
            .catch(() => {
              // Some streaming, cached, or opaque responses have no retrievable body.
            });
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
      bus.on<{ url: string; method?: string; headers?: Record<string, string> }, NetworkReplayResult>(
        MESSAGE_TYPE.NETWORK_FETCH,
        ({ url, method, headers }) => fetchUrl(url, method, headers),
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
          const created = await chrome.tabs.create({ url, active: false });
          if (created.id === undefined) {
            throw new Error("Network replay could not create a target tab.");
          }
          targetTabId = created.id;
          createdTabId = created.id;
          await new Promise<void>((resolve) => {
            const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
              if (updatedTabId !== createdTabId || changeInfo.status !== "complete") return;
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
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
