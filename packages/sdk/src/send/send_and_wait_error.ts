import type { ccc } from "@ckb-ccc/core";

export class TransactionConfirmationError extends Error {
  public readonly txHash: ccc.Hex;
  public readonly status: string | undefined;
  public readonly isTimeout: boolean;
  public readonly reason: string | undefined;

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
