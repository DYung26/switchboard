      const BASE_URL_KEY = "apiscribe:bridge-base-url";
      const TOKEN_KEY = "apiscribe:bridge-token";
      const baseUrlInput = document.querySelector("#base-url");
      const tokenInput = document.querySelector("#token");
      const status = document.querySelector("#status");
      const connectButton = document.querySelector("#connect");
      const disconnectButton = document.querySelector("#disconnect");
      let running = false;

      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

      function normalizeBaseUrl(value) {
        const url = new URL(value);
        if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
          throw new Error("Use HTTPS for remote servers, or HTTP only for localhost.");
        }
        return url.origin;
      }

      async function sendToSwitchboard(type, payload) {
        const result = await chrome.runtime.sendMessage({ type, payload });
        if (result?.error) throw new Error(result.error);
        return result;
      }

      async function waitForTabLoad(tabId) {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") return;
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error("Provider tab did not finish loading."));
          }, 20000);
          const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          };
          chrome.tabs.onUpdated.addListener(listener);
          void chrome.tabs.get(tabId).then((currentTab) => {
            if (currentTab.status !== "complete") return;
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }).catch((error) => {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            reject(error);
          });
        });
      }

      async function getOrCreateProviderTab(origin) {
        const bridgeTab = await chrome.tabs.getCurrent();
        const tabs = await chrome.tabs.query({ url: origin + "/*", currentWindow: true });
        let tab = tabs.find((candidate) => candidate.active) || tabs[0];

        if (!tab) {
          tab = await chrome.tabs.create({
            ...(bridgeTab?.windowId !== undefined ? { windowId: bridgeTab.windowId } : {}),
            url: origin + "/",
            active: false,
          });
        }

        if (tab.id === undefined) throw new Error("Could not identify the provider browser tab.");
        await waitForTabLoad(tab.id);
        return tab.id;
      }

      async function runBridge(baseUrl, token) {
        running = true;
        connectButton.disabled = true;
        disconnectButton.disabled = false;
        status.textContent = "Connected to " + baseUrl + ". Waiting for APIScribe jobs.";

        while (running) {
          try {
            const response = await fetch(baseUrl + "/v1/bridge/jobs/next", {
              headers: { authorization: "Bearer " + token },
              cache: "no-store",
            });
            if (response.status === 204) {
              await wait(500);
              continue;
            }
            if (!response.ok) throw new Error("Job polling failed: HTTP " + response.status);

            const { job } = await response.json();
            let completion;
            try {
              if (job.operation === "switchboard.accounts.list") {
                const provider = await sendToSwitchboard("switchboard/provider/get", { provider: job.payload.provider });
                const accounts = await sendToSwitchboard("switchboard/account/list", { origin: provider.origin });
                completion = {
                  result: accounts.map(({ id, name, origin, createdAt, lastUsed }) => ({
                    id,
                    name,
                    origin,
                    createdAt,
                    ...(lastUsed !== undefined ? { lastUsed } : {}),
                  })),
                };
              } else {
                if (job.operation !== "provider.chat.completions.create" && job.operation !== "provider.conversations.get") {
                  throw new Error("Unsupported APIScribe bridge operation: " + job.operation);
                }
                const provider = await sendToSwitchboard("switchboard/provider/get", { provider: job.payload.provider });
                const tabId = await getOrCreateProviderTab(provider.origin);
                if (job.payload.accountId) {
                  await sendToSwitchboard("switchboard/account/switch-for-tab", {
                    accountId: job.payload.accountId,
                    origin: provider.origin,
                    tabId,
                  });
                }
                const type = job.operation === "provider.chat.completions.create"
                  ? "switchboard/provider/chat-completion/create"
                  : "switchboard/provider/conversation/get";
                completion = { result: await sendToSwitchboard(type, { ...job.payload, tabId }) };
              }
            } catch (error) {
              completion = { error: error instanceof Error ? error.message : String(error) };
            }

            const completed = await fetch(baseUrl + "/v1/bridge/jobs/" + job.id + "/complete", {
              method: "POST",
              headers: {
                authorization: "Bearer " + token,
                "content-type": "application/json",
              },
              body: JSON.stringify(completion),
            });
            if (!completed.ok) throw new Error("Job completion failed: HTTP " + completed.status);
            status.textContent = "Completed " + job.operation + ". Waiting for the next job.";
          } catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
            await wait(1500);
          }
        }

        connectButton.disabled = false;
        disconnectButton.disabled = true;
        status.textContent = "Disconnected.";
      }

      async function initialize() {
        const stored = await chrome.storage.local.get([BASE_URL_KEY, TOKEN_KEY]);
        baseUrlInput.value = stored[BASE_URL_KEY] ?? "";
        tokenInput.value = stored[TOKEN_KEY] ?? "";
      }

      connectButton.addEventListener("click", () => {
        try {
          const baseUrl = normalizeBaseUrl(baseUrlInput.value.trim());
          const token = tokenInput.value.trim();
          if (token.length < 32) throw new Error("Bridge token must contain at least 32 characters.");
          void chrome.storage.local.set({ [BASE_URL_KEY]: baseUrl, [TOKEN_KEY]: token })
            .then(() => runBridge(baseUrl, token))
            .catch((error) => { status.textContent = error instanceof Error ? error.message : String(error); });
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error);
        }
      });

      disconnectButton.addEventListener("click", () => {
        running = false;
      });

      void initialize().catch((error) => {
        status.textContent = error instanceof Error ? error.message : String(error);
      });
