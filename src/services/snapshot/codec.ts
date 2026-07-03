// IndexedDB values (and, less commonly, Cache Storage bodies) can contain
// JavaScript values that are not JSON-serializable: Date, Map, Set, RegExp,
// ArrayBuffer/TypedArrays, and Blob are all valid structured-clone types
// that IndexedDB accepts natively. Snapshots are ultimately persisted as
// JSON (via `chrome.storage.local`), so this codec converts between those
// runtime values and a JSON-safe `SerializedValue` tree (defined in
// `@/types/codec` so the type itself has no dependency on this module).
//
// This is intentionally not a general structured-clone polyfill. It covers
// the types that realistically show up in IndexedDB records and Cache
// Storage bodies. Anything else (functions, DOM nodes, WeakMap/WeakSet,
// etc.) is not structured-cloneable by IndexedDB in the first place and
// falls back to `{ kind: "unsupported" }`, which decodes to `undefined`.

import type { SerializedValue, TypedArrayCtorName } from "@/types";
import { TYPED_ARRAY_CTOR_NAMES } from "@/types";

export type { SerializedValue };

function isTypedArrayCtorName(name: string): name is TypedArrayCtorName {
  return (TYPED_ARRAY_CTOR_NAMES as readonly string[]).includes(name);
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

/**
 * Recursively encodes an arbitrary structured-clone-able value into a
 * JSON-safe `SerializedValue`. Async because `Blob` reading is async.
 * Guards against circular references (an object/array referencing an
 * ancestor of itself) by falling back to `{ kind: "unsupported" }` for the
 * cyclic edge rather than recursing forever.
 */
export async function encodeValue(
  value: unknown,
  seen: Set<unknown> = new Set(),
): Promise<SerializedValue> {
  if (value === undefined) return { kind: "undefined" };
  if (value === null) return { kind: "null" };

  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    return { kind: "primitive", value: value as string | number | boolean };
  }

  if (seen.has(value)) {
    return { kind: "unsupported", typeName: "circular" };
  }

  if (value instanceof Date) {
    return { kind: "date", value: value.getTime() };
  }

  if (value instanceof RegExp) {
    return { kind: "regexp", source: value.source, flags: value.flags };
  }

  if (value instanceof ArrayBuffer) {
    return { kind: "arraybuffer", base64: arrayBufferToBase64(value) };
  }

  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const ctor = value.constructor.name;
    if (isTypedArrayCtorName(ctor)) {
      const typedArray = value as unknown as { buffer: ArrayBuffer };
      return {
        kind: "typedarray",
        ctor,
        base64: arrayBufferToBase64(typedArray.buffer),
      };
    }
    return { kind: "unsupported", typeName: ctor };
  }

  if (typeof Blob !== "undefined" && value instanceof Blob) {
    const buffer = await value.arrayBuffer();
    return {
      kind: "blob",
      mimeType: value.type,
      base64: arrayBufferToBase64(buffer),
    };
  }

  if (value instanceof Map) {
    seen.add(value);
    const entries: [SerializedValue, SerializedValue][] = [];
    for (const [k, v] of value.entries()) {
      entries.push([await encodeValue(k, seen), await encodeValue(v, seen)]);
    }
    seen.delete(value);
    return { kind: "map", entries };
  }

  if (value instanceof Set) {
    seen.add(value);
    const items: SerializedValue[] = [];
    for (const item of value.values()) {
      items.push(await encodeValue(item, seen));
    }
    seen.delete(value);
    return { kind: "set", items };
  }

  if (Array.isArray(value)) {
    seen.add(value);
    const items: SerializedValue[] = [];
    for (const item of value) {
      items.push(await encodeValue(item, seen));
    }
    seen.delete(value);
    return { kind: "array", items };
  }

  if (type === "object") {
    seen.add(value);
    const entries: [string, SerializedValue][] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      entries.push([k, await encodeValue(v, seen)]);
    }
    seen.delete(value);
    return { kind: "object", entries };
  }

  // functions, symbols, bigint (outside typed arrays) - not structured
  // clone types IndexedDB would ever hand us, but guard anyway.
  return { kind: "unsupported", typeName: type };
}

/**
 * Reconstructs a runtime value from a `SerializedValue`. Unknown/malformed
 * `kind` values decode to `undefined` and log a warning rather than
 * throwing, so one corrupted record does not abort restoration of the rest
 * of a snapshot.
 */
export function decodeValue(serialized: SerializedValue): unknown {
  switch (serialized.kind) {
    case "undefined":
    case "unsupported":
      return undefined;
    case "null":
      return null;
    case "primitive":
      return serialized.value;
    case "date":
      return new Date(serialized.value);
    case "regexp":
      return new RegExp(serialized.source, serialized.flags);
    case "arraybuffer":
      return base64ToArrayBuffer(serialized.base64);
    case "typedarray": {
      const buffer = base64ToArrayBuffer(serialized.base64);
      return new globalThis[serialized.ctor](buffer);
    }
    case "blob": {
      const buffer = base64ToArrayBuffer(serialized.base64);
      return new Blob([buffer], { type: serialized.mimeType });
    }
    case "map":
      return new Map(
        serialized.entries.map(([k, v]) => [decodeValue(k), decodeValue(v)]),
      );
    case "set":
      return new Set(serialized.items.map((item) => decodeValue(item)));
    case "array":
      return serialized.items.map((item) => decodeValue(item));
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of serialized.entries) {
        obj[k] = decodeValue(v);
      }
      return obj;
    }
    default: {
      console.warn(
        "[Switchboard] Unknown SerializedValue kind while decoding; substituting undefined.",
        serialized,
      );
      return undefined;
    }
  }
}
