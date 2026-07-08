import type { ccc } from "@ckb-ccc/core";

/**
 * Error thrown after a sent transaction times out or reaches a terminal failure.
 *
 * @public
 */
export class TransactionConfirmationError extends Error {
  /** Hash of the transaction whose confirmation failed. */
  public readonly txHash: ccc.Hex;
  /** Last known node status for the transaction, when available. */
  public readonly status: string | undefined;
  /** True when confirmation polling exhausted its check budget. */
  public readonly isTimeout: boolean;
  /** Node-provided rejection or failure reason, when available. */
  public readonly reason: string | undefined;

  /**
   * Creates a confirmation error carrying the transaction hash and last known status.
   */
  constructor(
    ...[message, options, txHash, status, isTimeout, reason]: [
      message: string,
      options: ErrorOptions | undefined,
      txHash: ccc.Hex,
      status: string | undefined,
      isTimeout: boolean,
      reason?: string,
    ]
  ) {
    super(message, options);
    this.name = "TransactionConfirmationError";
    this.txHash = txHash;
    this.status = status;
    this.isTimeout = isTimeout;
    this.reason = reason;
  }
}
