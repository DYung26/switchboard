// JSON-safe representation of structured-clone-able JS values that show up
// in IndexedDB records and Cache Storage bodies but aren't directly
// JSON-serializable. See `src/services/snapshot/codec.ts` for the
// encode/decode implementation - this file only holds the shared type so
// that other `types/` modules (e.g. `snapshot.ts`) can reference it without
// `types/` depending on `services/`.

export const TYPED_ARRAY_CTOR_NAMES = [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
] as const;

export type TypedArrayCtorName = (typeof TYPED_ARRAY_CTOR_NAMES)[number];

export type SerializedValue =
  | { kind: "undefined" }
  | { kind: "null" }
  | { kind: "primitive"; value: string | number | boolean }
  | { kind: "date"; value: number }
  | { kind: "regexp"; source: string; flags: string }
  | { kind: "array"; items: SerializedValue[] }
  | { kind: "object"; entries: [string, SerializedValue][] }
  | { kind: "map"; entries: [SerializedValue, SerializedValue][] }
  | { kind: "set"; items: SerializedValue[] }
  | { kind: "arraybuffer"; base64: string }
  | { kind: "typedarray"; ctor: TypedArrayCtorName; base64: string }
  | { kind: "blob"; mimeType: string; base64: string }
  | { kind: "unsupported"; typeName: string };
