export const WEB_STORAGE_KIND = {
  LOCAL: "local",
  SESSION: "session",
} as const;

export type WebStorageKind =
  (typeof WEB_STORAGE_KIND)[keyof typeof WEB_STORAGE_KIND];
