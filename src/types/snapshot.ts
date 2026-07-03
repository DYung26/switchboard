import type { SerializedValue } from "./codec";

export const STORAGE_MECHANISM = {
  COOKIES: "cookies",
  LOCAL_STORAGE: "localStorage",
  SESSION_STORAGE: "sessionStorage",
  INDEXED_DB: "indexedDB",
  CACHE_STORAGE: "cacheStorage",
} as const;

export type StorageMechanism =
  (typeof STORAGE_MECHANISM)[keyof typeof STORAGE_MECHANISM];

export interface CapturedCookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: chrome.cookies.SameSiteStatus;
  expirationDate: number | undefined;
  storeId: string;
}

export type WebStorageRecords = Record<string, string>;

// --- IndexedDB ---------------------------------------------------------

export interface CapturedIndexedDbIndex {
  name: string;
  keyPath: string | string[];
  unique: boolean;
  multiEntry: boolean;
}

export interface CapturedIndexedDbRecord {
  key: SerializedValue;
  value: SerializedValue;
}

export interface CapturedIndexedDbObjectStore {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: CapturedIndexedDbIndex[];
  records: CapturedIndexedDbRecord[];
}

export interface CapturedIndexedDbDatabase {
  name: string;
  version: number;
  objectStores: CapturedIndexedDbObjectStore[];
}

// --- Cache Storage -------------------------------------------------------

export type CachedBodyEncoding = "text" | "base64" | "empty";

export interface CapturedCacheEntry {
  url: string;
  method: string;
  requestHeaders: [string, string][];
  status: number;
  statusText: string;
  responseHeaders: [string, string][];
  bodyEncoding: CachedBodyEncoding;
  body: string;
}

export interface CapturedCache {
  name: string;
  entries: CapturedCacheEntry[];
}

// --- Snapshot data (current schema) --------------------------------------

export interface SessionSnapshotData {
  [STORAGE_MECHANISM.COOKIES]: CapturedCookie[];
  [STORAGE_MECHANISM.LOCAL_STORAGE]: WebStorageRecords;
  [STORAGE_MECHANISM.SESSION_STORAGE]: WebStorageRecords;
  [STORAGE_MECHANISM.INDEXED_DB]: CapturedIndexedDbDatabase[];
  [STORAGE_MECHANISM.CACHE_STORAGE]: CapturedCache[];
}

export const SNAPSHOT_SCHEMA_VERSION = 2;

export interface SessionSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  origin: string;
  capturedAt: number;
  data: SessionSnapshotData;
}

// --- Legacy schema (v1), retained only for migration ---------------------
//
// v1 snapshots predate IndexedDB/CacheStorage support and only ever
// contained cookies + web storage. They may still exist in a user's
// `chrome.storage.local` from before this upgrade. `migrateSnapshot`
// (see `services/snapshot/snapshot-migration.ts`) upgrades them to the
// current schema on read. Do not add new fields here — this type is frozen
// to describe historical data only.

export const SNAPSHOT_SCHEMA_VERSION_V1 = 1;

export interface SessionSnapshotDataV1 {
  [STORAGE_MECHANISM.COOKIES]: CapturedCookie[];
  [STORAGE_MECHANISM.LOCAL_STORAGE]: WebStorageRecords;
  [STORAGE_MECHANISM.SESSION_STORAGE]: WebStorageRecords;
}

export interface SessionSnapshotV1 {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION_V1;
  origin: string;
  capturedAt: number;
  data: SessionSnapshotDataV1;
}

/**
 * The union of every schema version a snapshot might be in when read back
 * from persistent storage (`chrome.storage.local`, an imported backup,
 * etc.). Always pass values of this type through `migrateSnapshot` before
 * treating them as a current-schema `SessionSnapshot`.
 */
export type StoredSessionSnapshot = SessionSnapshot | SessionSnapshotV1;
