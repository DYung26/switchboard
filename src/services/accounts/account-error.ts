export const ACCOUNT_ERROR_CODE = {
  NOT_FOUND: "not_found",
  INVALID_NAME: "invalid_name",
  DUPLICATE_NAME: "duplicate_name",
  STORAGE_FAILURE: "storage_failure",
} as const;

export type AccountErrorCode =
  (typeof ACCOUNT_ERROR_CODE)[keyof typeof ACCOUNT_ERROR_CODE];

export class AccountError extends Error {
  readonly code: AccountErrorCode;
  override readonly cause: unknown;

  constructor(code: AccountErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "AccountError";
    this.code = code;
    this.cause = cause;
  }
}
