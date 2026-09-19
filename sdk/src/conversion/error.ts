/** Stable machine-readable failures owned by the Phase-2 SDK. */
export type IckbErrorCode = "insufficient_capacity" | "insufficient_ickb";

/** Typed SDK failure with a stable machine-readable code. */
export class IckbError extends Error {
  /** Stable failure code for callers and observability. */
  public readonly code: IckbErrorCode;

  /** Creates a typed SDK failure while preserving its cause. */
  constructor(message: string, options: ErrorOptions & { code: IckbErrorCode }) {
    super(message, options);
    this.name = "IckbError";
    this.code = options.code;
  }
}
