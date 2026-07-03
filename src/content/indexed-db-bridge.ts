import type {
  CapturedIndexedDbDatabase,
  CapturedIndexedDbIndex,
  CapturedIndexedDbObjectStore,
  CapturedIndexedDbRecord,
} from "@/types";
import { encodeValue, decodeValue } from "@/services/snapshot/codec";
import { yieldToUi } from "./yield-to-ui";

// Records are read/written in batches, each within its own IndexedDB
// transaction. This keeps memory bounded for large stores and lets us
// yield to the UI thread *between* transactions - yielding via a macrotask
// (setTimeout) from inside an open transaction's callback would let the
// transaction auto-commit before `cursor.continue()` runs, throwing
// `TransactionInactiveError`. Opening a fresh transaction per batch avoids
// that entirely.
const RECORD_BATCH_SIZE = 250;

export async function isIndexedDbSupported(): Promise<boolean> {
  return (
    typeof indexedDB !== "undefined" &&
    typeof indexedDB.databases === "function"
  );
}

export async function collectIndexedDb(): Promise<CapturedIndexedDbDatabase[]> {
  if (!(await isIndexedDbSupported())) {
    return [];
  }

  // `indexedDB.databases()` is how modern Chromium enumerates databases for
  // an origin. It is not part of the IndexedDB spec and is unavailable in
  // Firefox/Safari as of this writing - documented as a browser limitation.
  const infos = await indexedDB.databases();
  const databases: CapturedIndexedDbDatabase[] = [];

  for (const info of infos) {
    if (!info.name) continue;
    // A single database failing to open (e.g. blocked by another open
    // connection elsewhere in the browser) shouldn't discard every other
    // database's data - skip and log rather than aborting the whole
    // mechanism, mirroring the per-database resilience `restoreIndexedDb`
    // already has.
    try {
      databases.push(await collectDatabase(info.name));
    } catch (error) {
      console.warn(
        `[Switchboard] Skipping unreadable IndexedDB database "${info.name}".`,
        error,
      );
    }
  }

  return databases;
}

async function collectDatabase(
  name: string,
): Promise<CapturedIndexedDbDatabase> {
  const db = await openForRead(name);
  try {
    const objectStores: CapturedIndexedDbObjectStore[] = [];
    for (const storeName of Array.from(db.objectStoreNames)) {
      try {
        objectStores.push(await collectObjectStore(db, storeName));
      } catch (error) {
        console.warn(
          `[Switchboard] Skipping unreadable object store "${storeName}" in database "${name}".`,
          error,
        );
      }
    }
    return { name, version: db.version, objectStores };
  } finally {
    db.close();
  }
}

function openForRead(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ??
          new Error(`Failed to open IndexedDB database "${name}".`),
      );
    request.onblocked = () =>
      reject(
        new Error(
          `Opening IndexedDB database "${name}" was blocked by another open connection.`,
        ),
      );
  });
}

function readStoreMetadata(
  db: IDBDatabase,
  storeName: string,
): Pick<CapturedIndexedDbObjectStore, "keyPath" | "autoIncrement" | "indexes"> {
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const indexes: CapturedIndexedDbIndex[] = Array.from(store.indexNames).map(
    (indexName) => {
      const index = store.index(indexName);
      return {
        name: index.name,
        keyPath: index.keyPath as string | string[],
        unique: index.unique,
        multiEntry: index.multiEntry,
      };
    },
  );

  return {
    keyPath: store.keyPath as string | string[] | null,
    autoIncrement: store.autoIncrement,
    indexes,
  };
}

async function collectObjectStore(
  db: IDBDatabase,
  storeName: string,
): Promise<CapturedIndexedDbObjectStore> {
  const meta = readStoreMetadata(db, storeName);
  const records: CapturedIndexedDbRecord[] = [];
  let afterKey: IDBValidKey | undefined;

  for (;;) {
    const { batch, exhausted } = await readBatch(db, storeName, afterKey);

    for (const [key, value] of batch) {
      records.push({
        key: await encodeValue(key),
        value: await encodeValue(value),
      });
    }

    if (batch.length > 0) {
      afterKey = batch[batch.length - 1]![0];
    }

    if (exhausted) break;
    await yieldToUi();
  }

  return { name: storeName, ...meta, records };
}

function readBatch(
  db: IDBDatabase,
  storeName: string,
  afterKey: IDBValidKey | undefined,
): Promise<{ batch: [IDBValidKey, unknown][]; exhausted: boolean }> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const range =
      afterKey !== undefined ? IDBKeyRange.lowerBound(afterKey, true) : null;
    const request = store.openCursor(range);
    const batch: [IDBValidKey, unknown][] = [];

    request.onerror = () =>
      reject(
        request.error ??
          new Error(`Failed to read object store "${storeName}".`),
      );

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || batch.length >= RECORD_BATCH_SIZE) {
        resolve({ batch, exhausted: !cursor });
        return;
      }
      batch.push([cursor.key, cursor.value]);
      cursor.continue();
    };
  });
}

export async function clearIndexedDb(): Promise<void> {
  if (!(await isIndexedDbSupported())) return;

  const infos = await indexedDB.databases();
  const failures: unknown[] = [];

  for (const info of infos) {
    if (!info.name) continue;
    try {
      await clearDatabase(info.name);
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to clear ${failures.length} of ${infos.length} IndexedDB database(s).`,
    );
  }
}

// Deliberately does NOT use `indexedDB.deleteDatabase()`. Deleting requires
// exclusive access to the database, so it fires `onblocked` - not an error -
// whenever any other connection is still open, which on a live, not-yet-
// reloaded page is nearly always true (most apps keep at least one
// long-lived IndexedDB connection open). Worse, a blocked delete request
// doesn't fail on the browser's side - it stays queued waiting for the
// blocking connection to close, so a retried `deleteDatabase()` call for
// the same name queues behind it and can hang indefinitely.
//
// Opening at the current version and clearing each object store's records
// in a `readwrite` transaction achieves the same "empty database" result
// without requiring exclusive access, since it's not a version change.
async function clearDatabase(name: string): Promise<void> {
  const db = await openForRead(name);
  try {
    const storeNames = Array.from(db.objectStoreNames);
    if (storeNames.length === 0) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(
          tx.error ??
            new Error(`Transaction aborted while clearing database "${name}".`),
        );
      for (const storeName of storeNames) {
        tx.objectStore(storeName).clear();
      }
    });
  } finally {
    db.close();
  }
}

export async function restoreIndexedDb(
  databases: CapturedIndexedDbDatabase[],
): Promise<void> {
  if (!(await isIndexedDbSupported())) return;

  const failures: unknown[] = [];

  for (const database of databases) {
    try {
      await restoreDatabase(database);
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to restore ${failures.length} of ${databases.length} IndexedDB database(s).`,
    );
  }
}

async function restoreDatabase(
  database: CapturedIndexedDbDatabase,
): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(
      database.name,
      Math.max(database.version, 1),
    );

    request.onupgradeneeded = () => {
      const target = request.result;
      for (const store of database.objectStores) {
        if (target.objectStoreNames.contains(store.name)) {
          target.deleteObjectStore(store.name);
        }
        const created = target.createObjectStore(store.name, {
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
        });
        for (const index of store.indexes) {
          created.createIndex(index.name, index.keyPath, {
            unique: index.unique,
            multiEntry: index.multiEntry,
          });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ??
          new Error(
            `Failed to open IndexedDB database "${database.name}" for restore.`,
          ),
      );
    request.onblocked = () =>
      reject(
        new Error(
          `Restoring IndexedDB database "${database.name}" was blocked by another open connection.`,
        ),
      );
  });

  try {
    for (const store of database.objectStores) {
      await restoreObjectStoreRecords(db, store);
    }
  } finally {
    db.close();
  }
}

async function restoreObjectStoreRecords(
  db: IDBDatabase,
  store: CapturedIndexedDbObjectStore,
): Promise<void> {
  const inline = store.keyPath !== null;

  for (let i = 0; i < store.records.length; i += RECORD_BATCH_SIZE) {
    const batch = store.records.slice(i, i + RECORD_BATCH_SIZE);

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store.name, "readwrite");
      const objectStore = tx.objectStore(store.name);

      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(
          tx.error ??
            new Error(
              `Transaction aborted while restoring object store "${store.name}".`,
            ),
        );

      for (const record of batch) {
        const key = decodeValue(record.key);
        const value = decodeValue(record.value);

        try {
          const request = inline
            ? objectStore.put(value)
            : objectStore.put(value, key as IDBValidKey);

          // A single record failing (e.g. quota exceeded, or a decoded
          // value that no longer matches an in-line keyPath) shouldn't
          // abort every other record in this batch's transaction.
          // preventDefault() stops the request's error from bubbling up
          // and auto-aborting the transaction.
          request.onerror = (event) => {
            event.preventDefault();
            console.warn(
              `[Switchboard] Skipping unrestorable record in object store "${store.name}".`,
              request.error,
            );
          };
        } catch (error) {
          console.warn(
            `[Switchboard] Skipping unrestorable record in object store "${store.name}".`,
            error,
          );
        }
      }
    });

    if (i + RECORD_BATCH_SIZE < store.records.length) {
      await yieldToUi();
    }
  }
}
