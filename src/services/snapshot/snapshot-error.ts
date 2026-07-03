export const SNAPSHOT_ERROR_CODE = {
  UNSUPPORTED_PAGE: "unsupported_page",
  NO_ACTIVE_TAB: "no_active_tab",
  MISSING_PERMISSION: "missing_permission",
  INVALID_SNAPSHOT: "invalid_snapshot",
  ORIGIN_MISMATCH: "origin_mismatch",
  COLLECTOR_FAILURE: "collector_failure",
  QUOTA_EXCEEDED: "quota_exceeded",
  SERIALIZATION_FAILURE: "serialization_failure",
} as const;

export type SnapshotErrorCode =
  (typeof SNAPSHOT_ERROR_CODE)[keyof typeof SNAPSHOT_ERROR_CODE];

export class SnapshotError extends Error {
  readonly code: SnapshotErrorCode;
  override readonly cause: unknown;

  constructor(code: SnapshotErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "SnapshotError";
    this.code = code;
    this.cause = cause;
  }
}

export interface MechanismFailure {
  mechanism: string;
  error: unknown;
}

// `SnapshotError.cause` doesn't survive `chrome.runtime`/`chrome.tabs`
// messaging - the background/popup boundary only forwards `Error.message`
// (see `messaging/message-bus.ts`). Folding the per-mechanism detail into
// the message itself is what makes it visible to the user and in logs on
// the other side of that boundary.
export function describeMechanismFailures(failures: MechanismFailure[]): string {
  return failures
    .map(
      (failure) =>
        `${failure.mechanism}: ${
          failure.error instanceof Error
            ? failure.error.message
            : String(failure.error)
        }`,
    )
    .join("; ");
}
