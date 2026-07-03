import type {
  CachedBodyEncoding,
  CapturedCache,
  CapturedCacheEntry,
} from "@/types";
import { yieldToUi } from "./yield-to-ui";

const ENTRY_BATCH_SIZE = 50;

// Bodies larger than this are base64-encoded without attempting a text
// decode first, since attempting to UTF-8-decode a large binary payload
// (e.g. an image or video cached by a service worker) just to discover it
// isn't text wastes time on something we can often already tell from the
// content-type header.
const MAX_TEXT_DECODE_ATTEMPT_BYTES = 2_000_000;

const TEXTUAL_CONTENT_TYPE = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded))/i;

export function isCacheStorageSupported(): boolean {
  return typeof caches !== "undefined";
}

export async function collectCacheStorage(): Promise<CapturedCache[]> {
  if (!isCacheStorageSupported()) return [];

  const names = await caches.keys();
  const result: CapturedCache[] = [];
  for (const name of names) {
    // One cache failing to enumerate shouldn't discard every other cache's
    // entries - skip and log rather than aborting the whole mechanism,
    // mirroring the per-cache resilience `restoreCacheStorage` already has.
    try {
      result.push(await collectCache(name));
    } catch (error) {
      console.warn(`[Switchboard] Skipping unreadable cache "${name}".`, error);
    }
  }
  return result;
}

async function collectCache(name: string): Promise<CapturedCache> {
  const cache = await caches.open(name);
  const requests = await cache.keys();
  const entries: CapturedCacheEntry[] = [];
  let skipped = 0;

  for (let i = 0; i < requests.length; i++) {
    const request = requests[i]!;
    try {
      const entry = await collectEntry(cache, request);
      if (entry) entries.push(entry);
    } catch (error) {
      // A single entry can fail to read (e.g. a body stream that's already
      // disturbed/locked elsewhere) without invalidating the rest of the
      // cache's entries.
      skipped += 1;
      console.warn(
        `[Switchboard] Skipping unreadable cache entry "${request.url}" in cache "${name}".`,
        error,
      );
    }
    if ((i + 1) % ENTRY_BATCH_SIZE === 0) {
      await yieldToUi();
    }
  }

  if (skipped > 0) {
    console.warn(
      `[Switchboard] Skipped ${skipped} of ${requests.length} entries while capturing cache "${name}".`,
    );
  }

  return { name, entries };
}

async function collectEntry(
  cache: Cache,
  request: Request,
): Promise<CapturedCacheEntry | undefined> {
  const response = await cache.match(request);
  if (!response) return undefined;

  // Cache Storage can contain "opaque" responses (from no-cors cross-origin
  // requests) whose body is deliberately inaccessible to JS. We can still
  // capture the request/response metadata, but the body reads as an empty
  // ArrayBuffer - documented limitation, not a bug in this collector.
  const buffer = await response.clone().arrayBuffer();
  const { encoding, body } = encodeBody(
    buffer,
    response.headers.get("content-type"),
  );

  return {
    url: request.url,
    method: request.method,
    requestHeaders: Array.from(request.headers.entries()),
    status: response.status,
    statusText: response.statusText,
    responseHeaders: Array.from(response.headers.entries()),
    bodyEncoding: encoding,
    body,
  };
}

function encodeBody(
  buffer: ArrayBuffer,
  contentType: string | null,
): { encoding: CachedBodyEncoding; body: string } {
  if (buffer.byteLength === 0) {
    return { encoding: "empty", body: "" };
  }

  const looksTextual =
    contentType === null || TEXTUAL_CONTENT_TYPE.test(contentType);

  if (looksTextual && buffer.byteLength <= MAX_TEXT_DECODE_ATTEMPT_BYTES) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      return { encoding: "text", body: text };
    } catch {
      // Not valid UTF-8 text after all - fall through to base64.
    }
  }

  return { encoding: "base64", body: arrayBufferToBase64(buffer) };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function clearCacheStorage(): Promise<void> {
  if (!isCacheStorageSupported()) return;

  const names = await caches.keys();
  const failures: unknown[] = [];

  await Promise.all(
    names.map(async (name) => {
      try {
        await caches.delete(name);
      } catch (error) {
        failures.push(error);
      }
    }),
  );

  if (failures.length > 0) {
    throw new Error(
      `Failed to clear ${failures.length} of ${names.length} cache(s).`,
    );
  }
}

export async function restoreCacheStorage(
  cachesData: CapturedCache[],
): Promise<void> {
  if (!isCacheStorageSupported()) return;

  const failures: unknown[] = [];

  for (const cacheData of cachesData) {
    try {
      await restoreCache(cacheData);
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to restore ${failures.length} of ${cachesData.length} cache(s).`,
    );
  }
}

async function restoreCache(cacheData: CapturedCache): Promise<void> {
  const cache = await caches.open(cacheData.name);
  let skipped = 0;

  for (let i = 0; i < cacheData.entries.length; i++) {
    const entry = cacheData.entries[i]!;
    try {
      await restoreEntry(cache, entry);
    } catch (error) {
      // The Cache API rejects some responses outright (status 206 partial
      // content, a `Vary: *` header, etc.). Skip just that entry rather
      // than failing the whole cache - see docs/_local/snapshot-engine.md
      // for the full list of documented limitations.
      skipped += 1;
      console.warn(
        `[Switchboard] Skipping unrestorable cache entry "${entry.url}".`,
        error,
      );
    }
    if ((i + 1) % ENTRY_BATCH_SIZE === 0) {
      await yieldToUi();
    }
  }

  if (skipped > 0) {
    console.warn(
      `[Switchboard] Skipped ${skipped} of ${cacheData.entries.length} entries while restoring cache "${cacheData.name}".`,
    );
  }
}

async function restoreEntry(cache: Cache, entry: CapturedCacheEntry): Promise<void> {
  const request = new Request(entry.url, {
    method: entry.method,
    headers: entry.requestHeaders,
  });

  const body =
    entry.bodyEncoding === "empty"
      ? undefined
      : entry.bodyEncoding === "text"
        ? entry.body
        : base64ToArrayBuffer(entry.body);

  const response = new Response(body, {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.responseHeaders,
  });

  await cache.put(request, response);
}
