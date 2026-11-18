import { useCallback, useEffect, useRef, useState } from "react";
import { AISP_SESSION_SETTINGS_KEY } from "@/constants/app";
import { MESSAGE_TYPE } from "@/constants/messages";
import { sendMessage } from "@/messaging/send-message";
import { createChromeStorageService } from "@/storage";
import {
  identifyProviderConversation,
  type AiSPProvider,
} from "@/services/network/session-capture";

interface SessionSaveViewProps {
  tabId: number;
  onBack: () => void;
  autoSave?: boolean;
}

interface AiSPSettings {
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

const storageService = createChromeStorageService();

const DEFAULT_SETTINGS: AiSPSettings = {
  bridgeUrl: "http://127.0.0.1:47831",
  token: "",
  project: "",
  task: "",
};

const SAVE_TIMEOUT_MS = 120_000;

function normalizeBridgeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid AiSP bridge URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The AiSP bridge URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The AiSP bridge URL must contain only an origin, without credentials or query parameters.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("Enter the AiSP bridge origin only, without an API path.");
  }

  return url.origin;
}

export function SessionSaveView({
  tabId,
  onBack,
  autoSave = false,
}: SessionSaveViewProps): JSX.Element {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [hasStoredSettings, setHasStoredSettings] = useState(false);
  const autoSaveStarted = useRef(false);
  const [provider, setProvider] = useState<AiSPProvider>();
  const [conversationId, setConversationId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState<"idle" | "capturing" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string>();
  const [result, setResult] = useState<AiSPImportResult>();

  useEffect(() => {
    let active = true;

    async function loadSettings(): Promise<void> {
      try {
        const stored = await storageService.get<AiSPSettings>(AISP_SESSION_SETTINGS_KEY);
        if (!active) return;
        if (stored) {
          setSettings({ ...DEFAULT_SETTINGS, ...stored });
          setHasStoredSettings(
            Boolean(stored.token?.trim() && stored.project?.trim() && stored.task?.trim()),
          );
        }
      } catch (error) {
        if (!active) return;
        setPhase("error");
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) setSettingsLoaded(true);
      }
    }

    void loadSettings();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setProvider(undefined);
    setConversationId(undefined);

    async function identifyCurrentTab(): Promise<void> {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (!active) return;
        const target = identifyProviderConversation(tab.url ?? "");
        setProvider(target.provider);
        setConversationId(target.conversationId);
      } catch (error) {
        if (!active) return;
        setPhase("error");
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }

    void identifyCurrentTab();

    return () => {
      active = false;
    };
  }, [tabId]);

  function updateSetting<K extends keyof AiSPSettings>(
    key: K,
    value: AiSPSettings[K],
  ): void {
    setSettings((current) => ({ ...current, [key]: value }));
    setPhase("idle");
    setMessage(undefined);
    setResult(undefined);
  }

  const handleSave = useCallback(async (): Promise<void> => {
    if (saving || !conversationId || !provider) return;

    setSaving(true);
    setPhase("capturing");
    setMessage("Reloading the page, capturing the conversation, and importing it into AiSP…");
    setResult(undefined);

    try {
      normalizeBridgeUrl(settings.bridgeUrl);
      if (!settings.token.trim()) throw new Error("Enter the AiSP bridge token.");
      if (!settings.project.trim()) throw new Error("Enter the AiSP project name.");
      if (!settings.task.trim()) throw new Error("Enter the AiSP task name.");

      await storageService.set(AISP_SESSION_SETTINGS_KEY, settings);

      const imported = await sendMessage<
        { tabId: number; provider: AiSPProvider; conversationId: string },
        AiSPImportResult
      >(
        MESSAGE_TYPE.NETWORK_SESSION_SAVE,
        { tabId, provider, conversationId },
        SAVE_TIMEOUT_MS,
      );
      setResult(imported);
      setPhase("saved");
      setMessage("Session saved to AiSP.");
    } catch (error) {
      setPhase("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [saving, conversationId, provider, settings, tabId]);

  useEffect(() => {
    if (
      !autoSave ||
      !hasStoredSettings ||
      !settingsLoaded ||
      !provider ||
      !conversationId ||
      autoSaveStarted.current
    ) {
      return;
    }
    autoSaveStarted.current = true;
    void handleSave();
  }, [autoSave, hasStoredSettings, settingsLoaded, provider, conversationId, handleSave]);

  return (
    <section className="session-save">
      <div className="session-save__header">
        <button className="btn btn--ghost btn--sm" onClick={onBack} disabled={saving}>
          ← Back
        </button>
        <strong>Save session to AiSP</strong>
      </div>

      <div className="session-save__provider">
        <span>Provider</span>
        <strong>
          {provider === "chatgpt" ? "ChatGPT" : provider === "claude" ? "Claude" : "Detecting…"}
        </strong>
        {conversationId && <code>{conversationId}</code>}
      </div>

      <p className="session-save__hint">
        Switchboard reloads this page, retrieves the full conversation data, then imports it into AiSP.
      </p>

      <label className="session-save__field">
        <span>AiSP bridge URL</span>
        <input
          className="input"
          type="url"
          value={settings.bridgeUrl}
          onChange={(event) => updateSetting("bridgeUrl", event.target.value)}
          placeholder="http://127.0.0.1:47831"
          disabled={saving || !settingsLoaded}
          autoComplete="url"
        />
      </label>

      <label className="session-save__field">
        <span>Bridge token</span>
        <input
          className="input"
          type="password"
          value={settings.token}
          onChange={(event) => updateSetting("token", event.target.value)}
          placeholder="Bearer token"
          disabled={saving || !settingsLoaded}
          autoComplete="off"
        />
      </label>

      <div className="session-save__row">
        <label className="session-save__field">
          <span>Project</span>
          <input
            className="input"
            value={settings.project}
            onChange={(event) => updateSetting("project", event.target.value)}
            placeholder="e.g. aisp"
            disabled={saving || !settingsLoaded}
            autoComplete="off"
          />
        </label>
        <label className="session-save__field">
          <span>Task</span>
          <input
            className="input"
            value={settings.task}
            onChange={(event) => updateSetting("task", event.target.value)}
            placeholder="e.g. research"
            disabled={saving || !settingsLoaded}
            autoComplete="off"
          />
        </label>
      </div>

      {message && (
        <p className={`session-save__status session-save__status--${phase}`} role="status">
          {message}
        </p>
      )}

      {result && (
        <div className="session-save__result">
          <strong>{result.title || "Untitled conversation"}</strong>
          <span>{result.events} events · {result.session_id}</span>
          <code>{result.path}</code>
        </div>
      )}

      <button
        className="btn btn--primary session-save__submit"
        onClick={() => void handleSave()}
        disabled={
          saving ||
          phase === "saved" ||
          !settingsLoaded ||
          !provider ||
          !conversationId ||
          !settings.token.trim() ||
          !settings.project.trim() ||
          !settings.task.trim()
        }
      >
        {saving
          ? "Saving…"
          : "Save conversation"}
      </button>
    </section>
  );
}
