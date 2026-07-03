import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeStorageService } from "../chrome-storage-service";

function createChromeStorageMock() {
  const store = new Map<string, unknown>();
  const changeListeners = new Set<
    (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => void
  >();

  const local: Partial<chrome.storage.StorageArea> = {
    get: vi.fn(async (key: string) => ({
      [key]: store.get(key),
    })) as unknown as chrome.storage.StorageArea["get"],
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) {
        const oldValue = store.get(key);
        store.set(key, value);
        for (const listener of changeListeners) {
          listener({ [key]: { oldValue, newValue: value } }, "local");
        }
      }
    }),
    remove: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };

  return {
    local,
    onChanged: {
      addListener: vi.fn((listener) => changeListeners.add(listener)),
      removeListener: vi.fn((listener) => changeListeners.delete(listener)),
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("chrome", {
    storage: createChromeStorageMock(),
  });
});

describe("createChromeStorageService", () => {
  it("returns undefined for a key that was never set", async () => {
    const service = createChromeStorageService("local");
    await expect(service.get("missing")).resolves.toBeUndefined();
  });

  it("stores and retrieves a value", async () => {
    const service = createChromeStorageService("local");
    await service.set("account-name", "Personal");
    await expect(service.get("account-name")).resolves.toBe("Personal");
  });

  it("removes a stored value", async () => {
    const service = createChromeStorageService("local");
    await service.set("account-name", "Personal");
    await service.remove("account-name");
    await expect(service.get("account-name")).resolves.toBeUndefined();
  });

  it("notifies watchers when the watched key changes", async () => {
    const service = createChromeStorageService("local");
    const received: Array<string | undefined> = [];

    const unwatch = service.watch<string>("account-name", (change) => {
      received.push(change.newValue);
    });

    await service.set("account-name", "Work");
    unwatch();
    await service.set("account-name", "Client A");

    expect(received).toEqual(["Work"]);
  });
});
