import { useCallback, useEffect, useRef, useState } from "react";
import { MESSAGE_TYPE } from "@/constants/messages";
import { sendMessage } from "@/messaging/send-message";
import type {
  NetworkRequest,
  NetworkReplayResult,
  SavedNetworkRequest,
} from "@/types";

interface NetworkViewProps {
  tabId: number;
  onBack: () => void;
}

export function NetworkView({ tabId, onBack }: NetworkViewProps): JSX.Element {
  const [capturing, setCapturing] = useState(false);
  const [requests, setRequests] = useState<NetworkRequest[]>([]);
  const [saved, setSaved] = useState<SavedNetworkRequest[]>([]);
  const [selected, setSelected] = useState<NetworkRequest | undefined>();
  const [replay, setReplay] = useState<NetworkReplayResult | undefined>();
  const [editing, setEditing] = useState<SavedNetworkRequest | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [filter, setFilter] = useState("");
  const [detailTab, setDetailTab] = useState<"headers" | "body">("headers");
  const previousTabIdRef = useRef(tabId);

  const refresh = useCallback(async (): Promise<void> => {
    const nextRequests = await sendMessage<void, NetworkRequest[]>(
      MESSAGE_TYPE.NETWORK_CAPTURE_LIST,
      undefined,
    );
    setRequests(nextRequests);
    setSelected((current) =>
      current
        ? nextRequests.find((request) => request.id === current.id) ?? current
        : current,
    );
    setSaved(
      await sendMessage<void, SavedNetworkRequest[]>(
        MESSAGE_TYPE.NETWORK_SAVED_LIST,
        undefined,
      ),
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!capturing) return;
    const timer = window.setInterval(() => void refresh(), 750);
    return () => window.clearInterval(timer);
  }, [capturing, refresh]);

  useEffect(() => {
    const previousTabId = previousTabIdRef.current;
    previousTabIdRef.current = tabId;
    if (!capturing || previousTabId === tabId) return;

    void sendMessage<{ tabId: number }, void>(
      MESSAGE_TYPE.NETWORK_CAPTURE_START,
      { tabId },
    ).then(() => refresh()).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [tabId, capturing, refresh]);

  async function start(): Promise<void> {
    setError(undefined);
    try {
      await sendMessage<{ tabId: number }, void>(
        MESSAGE_TYPE.NETWORK_CAPTURE_START,
        { tabId },
      );
      setCapturing(true);
      setRequests([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function stop(): Promise<void> {
    await sendMessage<void, void>(MESSAGE_TYPE.NETWORK_CAPTURE_STOP, undefined);
    setCapturing(false);
    await refresh();
  }

  async function saveRequest(request: NetworkRequest): Promise<void> {
    const name = window.prompt("Name this request", request.url);
    if (name === null) return;
    await sendMessage<{ requestId: string; name: string }, SavedNetworkRequest>(
      MESSAGE_TYPE.NETWORK_SAVED_SAVE,
      { requestId: request.id, name },
    );
    await refresh();
  }

  async function updateRequest(request: SavedNetworkRequest): Promise<void> {
    try {
      const headers = JSON.parse(requestHeadersText) as Record<string, string>;
      await sendMessage<
        {
          id: string;
          name: string;
          url: string;
          method: string;
          requestHeaders: Record<string, string>;
          requestBody?: string;
        },
        SavedNetworkRequest
      >(MESSAGE_TYPE.NETWORK_SAVED_UPDATE, {
        id: request.id,
        name: requestName,
        url: requestUrl,
        method: requestMethod,
        requestHeaders: headers,
        ...(requestBodyText !== "" ? { requestBody: requestBodyText } : {}),
      });
      setEditing(undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const [requestName, setRequestName] = useState("");
  const [requestUrl, setRequestUrl] = useState("");
  const [requestMethod, setRequestMethod] = useState("");
  const [requestHeadersText, setRequestHeadersText] = useState("{}");
  const [requestBodyText, setRequestBodyText] = useState("");

  function beginEdit(request: SavedNetworkRequest): void {
    setEditing(request);
    setRequestName(request.name);
    setRequestUrl(request.url);
    setRequestMethod(request.method);
    setRequestHeadersText(JSON.stringify(request.requestHeaders, null, 2));
    setRequestBodyText(request.requestBody ?? "");
  }

  async function replayRequest(request: SavedNetworkRequest): Promise<void> {
    setError(undefined);
    try {
      const result = await sendMessage<
        { id: string; tabId: number },
        NetworkReplayResult
      >(MESSAGE_TYPE.NETWORK_REPLAY, { id: request.id, tabId });
      setReplay(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function copyResponse(): Promise<void> {
    if (!replay) return;
    await navigator.clipboard.writeText(replay.body);
  }

  function downloadResponse(): void {
    if (!replay) return;
    const blob = new Blob([replay.body], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "network-response.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="network-view">
      <div className="network-view__header">
        <button className="btn btn--ghost btn--sm" onClick={onBack}>
          ← Back
        </button>
        <strong>Network</strong>
        {capturing ? (
          <button className="btn btn--ghost btn--sm" onClick={() => void stop()}>
            Stop
          </button>
        ) : (
          <button className="btn btn--primary btn--sm" onClick={() => void start()}>
            Capture
          </button>
        )}
      </div>

      {error && <div className="popup__error">{error}</div>}

      <section className="network-view__section network-view__capture">
        <div className="network-view__toolbar">
          <div className="network-view__section-title">
            Requests ({requests.length})
          </div>
          <input
            className="input network-view__filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter URLs…"
            aria-label="Filter network requests"
          />
        </div>
        <div className="network-view__columns">
          <span>Method</span>
          <span>Name / URL</span>
          <span>Status</span>
          <span>Type</span>
        </div>
        {requests.length === 0 ? (
          <p className="popup__hint">Start capture, then use the page normally.</p>
        ) : (
          requests
            .filter((request) => request.url.toLowerCase().includes(filter.toLowerCase()))
            .map((request) => (
            <button
              key={request.id}
              className="network-view__request"
              onClick={() => setSelected(request)}
            >
              <span className="network-view__method">{request.method}</span>
              <span className="network-view__url">{request.url}</span>
              <span className="network-view__status">{request.status ?? "…"}
              </span>
              <span className="network-view__type">{request.mimeType?.split("/")[0] ?? "—"}</span>
              <span
                className="network-view__save"
                onClick={(event) => {
                  event.stopPropagation();
                  void saveRequest(request);
                }}
              >
                Save
              </span>
            </button>
          ))
        )}
      </section>

      {selected && (
        <section className="network-view__section network-view__details">
          <div className="network-view__detail-heading">
            <strong>{selected.method} {selected.url}</strong>
            <span className="network-view__status">{selected.status ?? "pending"}</span>
          </div>
          <div className="network-view__tabs">
            <button
              className={detailTab === "headers" ? "network-view__tab network-view__tab--active" : "network-view__tab"}
              onClick={() => setDetailTab("headers")}
            >
              Headers
            </button>
            <button
              className={detailTab === "body" ? "network-view__tab network-view__tab--active" : "network-view__tab"}
              onClick={() => setDetailTab("body")}
            >
              Body
            </button>
          </div>
          {detailTab === "headers" ? (
            <div className="network-view__header-groups">
              <div>
                <strong>Request headers</strong>
                <pre className="raw-view__pre">{JSON.stringify(selected.requestHeaders, null, 2)}</pre>
              </div>
              <div>
                <strong>Response headers</strong>
                <pre className="raw-view__pre">{JSON.stringify(selected.responseHeaders ?? {}, null, 2)}</pre>
              </div>
            </div>
          ) : (
            <div className="network-view__header-groups">
              <div>
                <strong>Request body</strong>
                <pre className="raw-view__pre">{selected.requestBody ?? ""}</pre>
              </div>
              <div>
                <strong>Response body</strong>
                <pre className="raw-view__pre">{selected.responseBody ?? ""}</pre>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="network-view__section">
        <div className="network-view__section-title">Saved requests</div>
        {saved.map((request) => (
          <div key={request.id} className="network-view__saved">
            <div className="network-view__url">{request.name}</div>
            <div className="network-view__saved-actions">
              <button className="btn btn--ghost btn--sm" onClick={() => beginEdit(request)}>
                Edit
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => void replayRequest(request)}>
                Replay
              </button>
              <button
                className="btn btn--ghost btn--sm btn--danger"
                onClick={() =>
                  void sendMessage<{ id: string }, void>(
                    MESSAGE_TYPE.NETWORK_SAVED_DELETE,
                    { id: request.id },
                  ).then(refresh)
                }
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {editing && (
          <div className="network-view__editor">
            <input className="input" value={requestName} onChange={(e) => setRequestName(e.target.value)} placeholder="Name" />
            <input className="input" value={requestMethod} onChange={(e) => setRequestMethod(e.target.value)} placeholder="Method" />
            <input className="input" value={requestUrl} onChange={(e) => setRequestUrl(e.target.value)} placeholder="URL" />
            <textarea className="network-view__textarea" value={requestHeadersText} onChange={(e) => setRequestHeadersText(e.target.value)} />
            <textarea className="network-view__textarea" value={requestBodyText} onChange={(e) => setRequestBodyText(e.target.value)} placeholder="Request body (optional)" />
            <div className="form__actions">
              <button className="btn btn--primary btn--sm" onClick={() => void updateRequest(editing)}>Save changes</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setEditing(undefined)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      {replay && (
        <section className="network-view__section">
          <div className="network-view__section-title">
            Response: {replay.status}
          </div>
          <div className="network-view__response-actions">
            <button className="btn btn--ghost btn--sm" onClick={() => void copyResponse()}>
              Copy
            </button>
            <button className="btn btn--ghost btn--sm" onClick={downloadResponse}>
              Download JSON
            </button>
          </div>
          <pre className="raw-view__pre">{replay.body}</pre>
        </section>
      )}
    </div>
  );
}
