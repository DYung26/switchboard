import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SavedAccount } from "@/types/account";
import { SORT_ORDER, type SortOrder } from "@/types/sort";
import { MESSAGE_TYPE } from "@/constants/messages";
import {
  activeAccountStorageKey,
  DEFAULT_SORT_ORDER,
  SORT_ORDER_STORAGE_KEY,
} from "@/constants/app";
import { sendMessage } from "@/messaging/send-message";
import { useStorageValue } from "@/hooks";
import { filterAccountsByQuery } from "@/utils/filter-accounts";
import { sortAccounts } from "@/utils/sort-accounts";
import { reorderIds } from "@/utils/reorder-ids";
import { getErrorMessage } from "@/utils/get-error-message";
import { AccountItem } from "./components/AccountItem";
import { SaveAccountForm } from "./components/SaveAccountForm";
import { RenameAccountForm } from "./components/RenameAccountForm";
import { RawAccountView } from "./components/RawAccountView";

type View = "list" | "save" | "raw";

interface RenameState {
  accountId: string;
}

interface ErrorState {
  message: string;
}

interface ReorderPayload {
  origin: string;
  orderedIds: string[];
}

interface AppProps {
  variant?: "popup" | "sidepanel";
}

async function getActiveOrigin(): Promise<string | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return undefined;
  try {
    return new URL(tab.url).origin;
  } catch {
    return undefined;
  }
}

const UNSUPPORTED_SCHEMES = ["chrome:", "edge:", "about:", "devtools:"];

function isUnsupportedOrigin(origin: string): boolean {
  return UNSUPPORTED_SCHEMES.some((scheme) => origin.startsWith(scheme));
}

export function App({ variant = "popup" }: AppProps = {}): JSX.Element {
  const rootClassName =
    variant === "sidepanel" ? "popup popup--sidepanel" : "popup";
  const [origin, setOrigin] = useState<string | undefined>(undefined);
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [view, setView] = useState<View>("list");
  const [renaming, setRenaming] = useState<RenameState | undefined>(undefined);
  const [viewingAccountId, setViewingAccountId] = useState<
    string | undefined
  >(undefined);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | undefined>(undefined);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<ErrorState | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [draggedId, setDraggedId] = useState<string | undefined>(undefined);
  const [dragOverId, setDragOverId] = useState<string | undefined>(undefined);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const [activeAccountId, , clearActiveAccountId] = useStorageValue<string>(
    origin ? activeAccountStorageKey(origin) : "",
  );
  const [sortOrder, setSortOrder] = useStorageValue<SortOrder>(
    SORT_ORDER_STORAGE_KEY,
  );
  const effectiveSortOrder = sortOrder ?? DEFAULT_SORT_ORDER;

  const loadAccounts = useCallback(async (o: string): Promise<void> => {
    const result = await sendMessage<{ origin: string }, SavedAccount[]>(
      MESSAGE_TYPE.ACCOUNT_LIST,
      { origin: o },
    );
    setAccounts(result);
  }, []);

  const refreshActiveTab = useCallback(async (): Promise<void> => {
    const o = await getActiveOrigin();
    setOrigin(o);
    if (o && !isUnsupportedOrigin(o)) {
      await loadAccounts(o);
    } else {
      setAccounts([]);
    }
  }, [loadAccounts]);

  useEffect(() => {
    void (async () => {
      await refreshActiveTab();
      setLoading(false);
    })();
  }, [refreshActiveTab]);

  // The side panel stays open across tab switches, unlike the popup which
  // is freshly mounted every time, so it needs to follow the active tab.
  useEffect(() => {
    if (variant !== "sidepanel") return;

    function handleTabChange(): void {
      setView("list");
      setRenaming(undefined);
      setViewingAccountId(undefined);
      setQuery("");
      setError(undefined);
      void refreshActiveTab();
    }

    function handleTabUpdated(
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ): void {
      if (changeInfo.url && tab.active) {
        handleTabChange();
      }
    }

    chrome.tabs.onActivated.addListener(handleTabChange);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);
    chrome.windows.onFocusChanged.addListener(handleTabChange);

    return () => {
      chrome.tabs.onActivated.removeListener(handleTabChange);
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
      chrome.windows.onFocusChanged.removeListener(handleTabChange);
    };
  }, [variant, refreshActiveTab]);

  useEffect(() => {
    if (variant === "popup" && !loading && accounts.length > 0) {
      searchInputRef.current?.focus();
    }
  }, [variant, loading, accounts.length]);

  const sortedAccounts = useMemo(
    () => sortAccounts(accounts, effectiveSortOrder),
    [accounts, effectiveSortOrder],
  );

  const filteredAccounts = useMemo(
    () => filterAccountsByQuery(sortedAccounts, query),
    [sortedAccounts, query],
  );

  const dragEnabled = query.trim().length === 0;

  const viewingAccount =
    view === "raw"
      ? accounts.find((a) => a.id === viewingAccountId)
      : undefined;

  async function handleSave(name: string): Promise<void> {
    const saved = await sendMessage<{ name: string }, SavedAccount>(
      MESSAGE_TYPE.ACCOUNT_SAVE,
      { name },
    );
    setAccounts((prev) => [...prev, saved]);
    setView("list");
  }

  async function handleSwitch(account: SavedAccount): Promise<void> {
    setSwitching(account.id);
    setError(undefined);
    try {
      await sendMessage<{ accountId: string; origin: string }, void>(
        MESSAGE_TYPE.ACCOUNT_SWITCH,
        { accountId: account.id, origin: account.origin },
      );
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === account.id ? { ...a, lastUsed: Date.now() } : a,
        ),
      );
    } catch (err) {
      setError({
        message: getErrorMessage(err, `Failed to switch to "${account.name}".`),
      });
    } finally {
      setSwitching(undefined);
    }
  }

  async function handleRename(
    account: SavedAccount,
    name: string,
  ): Promise<void> {
    const updated = await sendMessage<
      { accountId: string; origin: string; name: string },
      SavedAccount
    >(MESSAGE_TYPE.ACCOUNT_RENAME, {
      accountId: account.id,
      origin: account.origin,
      name,
    });
    setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setRenaming(undefined);
  }

  async function handleReplace(account: SavedAccount): Promise<void> {
    setError(undefined);
    try {
      const updated = await sendMessage<
        { accountId: string; origin: string },
        SavedAccount
      >(MESSAGE_TYPE.ACCOUNT_REPLACE, {
        accountId: account.id,
        origin: account.origin,
      });
      setAccounts((prev) =>
        prev.map((a) => (a.id === updated.id ? updated : a)),
      );
    } catch (err) {
      setError({
        message: getErrorMessage(err, `Failed to replace "${account.name}".`),
      });
    }
  }

  async function handleDuplicate(account: SavedAccount): Promise<void> {
    setError(undefined);
    try {
      const duplicate = await sendMessage<
        { accountId: string; origin: string },
        SavedAccount
      >(MESSAGE_TYPE.ACCOUNT_DUPLICATE, {
        accountId: account.id,
        origin: account.origin,
      });
      setAccounts((prev) => [...prev, duplicate]);
    } catch (err) {
      setError({
        message: getErrorMessage(
          err,
          `Failed to duplicate "${account.name}".`,
        ),
      });
    }
  }

  async function handleLogout(): Promise<void> {
    setLoggingOut(true);
    setError(undefined);
    try {
      await sendMessage<undefined, void>(MESSAGE_TYPE.SESSION_CLEAR, undefined);
      await clearActiveAccountId();
    } catch (err) {
      setError({
        message: getErrorMessage(err, "Failed to log out of this site."),
      });
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleDelete(account: SavedAccount): Promise<void> {
    setError(undefined);
    try {
      await sendMessage<{ accountId: string; origin: string }, void>(
        MESSAGE_TYPE.ACCOUNT_DELETE,
        { accountId: account.id, origin: account.origin },
      );
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
    } catch (err) {
      setError({
        message: getErrorMessage(err, `Failed to delete "${account.name}".`),
      });
    }
  }

  async function handleOpenSidePanel(): Promise<void> {
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow.id === undefined) return;
    await chrome.sidePanel.open({ windowId: currentWindow.id });
    window.close();
  }

  async function handleReorder(targetId: string): Promise<void> {
    if (!origin || !draggedId || draggedId === targetId) return;

    const currentIds = sortedAccounts.map((a) => a.id);
    const nextIds = reorderIds(currentIds, draggedId, targetId);
    if (nextIds === currentIds) return;

    if (effectiveSortOrder !== SORT_ORDER.CUSTOM) {
      void setSortOrder(SORT_ORDER.CUSTOM);
    }

    const reordered = await sendMessage<ReorderPayload, SavedAccount[]>(
      MESSAGE_TYPE.ACCOUNT_REORDER,
      { origin, orderedIds: nextIds },
    );
    setAccounts(reordered);
  }

  if (loading) {
    return (
      <main className={rootClassName}>
        <div className="popup__loading">Loading…</div>
      </main>
    );
  }

  if (!origin || isUnsupportedOrigin(origin ?? "")) {
    return (
      <main className={rootClassName}>
        <div className="popup__empty">
          <p>Switchboard doesn't work on this page.</p>
          <p className="popup__hint">Navigate to a website to manage accounts.</p>
        </div>
      </main>
    );
  }

  const hostname = new URL(origin).hostname;
  const existingNames = accounts.map((a) => a.name);

  return (
    <main className={rootClassName}>
      <header className="popup__header">
        <div className="popup__site">
          <span className="popup__site-name">{hostname}</span>
        </div>
        {view === "list" && (
          <div className="popup__header-actions">
            {variant === "popup" && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => void handleOpenSidePanel()}
                title="Open in side panel"
                aria-label="Open in side panel"
              >
                ⇥
              </button>
            )}
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              title="Clear this site's active session"
            >
              {loggingOut ? "Logging out…" : "Log Out"}
            </button>
            <button
              className="btn btn--primary btn--sm"
              onClick={() => {
                setView("save");
                setError(undefined);
              }}
            >
              + Save Current
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="popup__error" onClick={() => setError(undefined)}>
          {error.message}
        </div>
      )}

      {view === "save" && (
        <div className="popup__section">
          <SaveAccountForm
            onSave={handleSave}
            onCancel={() => setView("list")}
            existingNames={existingNames}
          />
        </div>
      )}

      {view === "raw" &&
        (viewingAccount ? (
          <RawAccountView
            account={viewingAccount}
            onBack={() => setView("list")}
          />
        ) : (
          <div className="popup__empty">
            <p>This account no longer exists.</p>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setView("list")}
            >
              ← Back
            </button>
          </div>
        ))}

      {view === "list" && (
        <>
          {accounts.length === 0 ? (
            <div className="popup__empty">
              <p>No saved accounts for this site.</p>
              <p className="popup__hint">
                Click <strong>+ Save Current</strong> to save the active session.
              </p>
            </div>
          ) : (
            <>
              <div className="popup__search">
                <input
                  ref={searchInputRef}
                  className="input"
                  type="text"
                  placeholder="Search accounts…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search accounts"
                />
                <select
                  className="popup__sort"
                  value={effectiveSortOrder}
                  onChange={(e) =>
                    void setSortOrder(e.target.value as SortOrder)
                  }
                  aria-label="Sort accounts by"
                >
                  <option value={SORT_ORDER.CUSTOM}>Custom order</option>
                  <option value={SORT_ORDER.CREATED}>Recently created</option>
                  <option value={SORT_ORDER.USED}>Recently used</option>
                </select>
              </div>

              {filteredAccounts.length === 0 ? (
                <div className="popup__empty">
                  <p>No accounts match &ldquo;{query}&rdquo;.</p>
                </div>
              ) : (
                <ul className="account-list">
                  {filteredAccounts.map((account) => {
                    if (renaming?.accountId === account.id) {
                      return (
                        <li key={account.id} className="account-list__item">
                          <RenameAccountForm
                            currentName={account.name}
                            existingNames={existingNames.filter(
                              (n) => n !== account.name,
                            )}
                            onRename={(name) => handleRename(account, name)}
                            onCancel={() => setRenaming(undefined)}
                          />
                        </li>
                      );
                    }

                    const itemClasses = [
                      "account-list__item",
                      switching === account.id &&
                        "account-list__item--switching",
                      draggedId === account.id && "account-list__item--dragging",
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <li
                        key={account.id}
                        className={itemClasses}
                        onDragOver={(e) => {
                          if (!draggedId) return;
                          e.preventDefault();
                          setDragOverId(account.id);
                        }}
                        onDragLeave={() =>
                          setDragOverId((current) =>
                            current === account.id ? undefined : current,
                          )
                        }
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverId(undefined);
                          void handleReorder(account.id);
                        }}
                      >
                        <AccountItem
                          account={account}
                          isActive={activeAccountId === account.id}
                          isDropTarget={
                            dragOverId === account.id &&
                            draggedId !== account.id
                          }
                          dragHandleProps={{
                            draggable: dragEnabled,
                            onDragStart: () => setDraggedId(account.id),
                            onDragEnd: () => {
                              setDraggedId(undefined);
                              setDragOverId(undefined);
                            },
                          }}
                          onSwitch={() => void handleSwitch(account)}
                          onRename={() =>
                            setRenaming({ accountId: account.id })
                          }
                          onReplace={() => void handleReplace(account)}
                          onDuplicate={() => void handleDuplicate(account)}
                          onViewRaw={() => {
                            setViewingAccountId(account.id);
                            setView("raw");
                          }}
                          onDelete={() => void handleDelete(account)}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
