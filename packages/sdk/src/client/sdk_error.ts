/** Stable machine-readable failures owned by the Phase-2 SDK. @public */
export type IckbErrorCode = "account_scan_limit" | "insufficient_capacity";

/** Typed SDK failure with a stable machine-readable code. @public */
export class IckbError extends Error {
  /** Stable failure code for callers and observability. */
  public readonly code: IckbErrorCode;

  /** These fund-safety failures require a fresh build or caller correction. */
  public readonly retryable = false;

  /** Creates a typed SDK failure while preserving its cause. */
  constructor(message: string, options: ErrorOptions & { code: IckbErrorCode }) {
    super(message, options);
    this.name = "IckbError";
    this.code = options.code;
  }
}

/** Returns whether a value is an SDK failure, optionally with one exact code. @public */
export function isIckbError(error: unknown, code?: IckbErrorCode): error is IckbError {
  return error instanceof IckbError && (code === undefined || error.code === code);
}
