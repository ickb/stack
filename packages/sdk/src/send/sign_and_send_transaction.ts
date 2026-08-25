import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";

/** Error from a broadcast whose locally computed transaction identity must be retained. @public */
export class TransactionBroadcastError extends Error {
  /** Chain transaction hash computed from the signed transaction before broadcast. */
  public readonly txHash: ccc.Hex;
  /** Inconsistent hash returned by the node, when that was the failure. */
  public readonly nodeTxHash: ccc.Hex | undefined;

  /** Creates a hash-preserving broadcast error. */
  constructor(txHash: ccc.Hex, options: ErrorOptions & { nodeTxHash?: ccc.Hex }) {
    const { nodeTxHash } = options;
    super(
      nodeTxHash === undefined
        ? `Transaction ${txHash} broadcast outcome is unresolved`
        : `Node returned transaction hash ${nodeTxHash}, expected ${txHash}`,
      options,
    );
    this.name = "TransactionBroadcastError";
    this.txHash = txHash;
    this.nodeTxHash = nodeTxHash;
  }
}

/**
 * Signs locally, records chain identity before RPC, then broadcasts without
 * CCC's cache wrapper.
 *
 * @remarks `recordTxHash` is called after the signed fee-rate guard and before
 * the send RPC starts. A node that already holds this exact transaction is an
 * acceptance; any other send failure remains ambiguous and throws
 * `TransactionBroadcastError`. The client cache is never marked: later attempts
 * rebuild from exact committed reads.
 *
 * @public
 */
export async function signAndSendTransaction(
  signer: ccc.Signer,
  tx: ccc.TransactionLike,
  recordTxHash?: (txHash: ccc.Hex) => void,
): Promise<ccc.Hex> {
  const signed = await signer.signTransaction(tx);
  const txHash = signed.hash();
  const feeRate = await signed.getFeeRate(signer.client);
  if (feeRate > cccA.DEFAULT_MAX_FEE_RATE) {
    throw new ccc.ErrorClientMaxFeeRateExceeded(cccA.DEFAULT_MAX_FEE_RATE, feeRate);
  }
  recordTxHash?.(txHash);

  let nodeTxHash: ccc.Hex;
  try {
    nodeTxHash = ccc.hexFrom(await signer.client.sendTransactionNoCache(signed));
  } catch (cause) {
    // A duplicate submission of this exact transaction is already accepted; a
    // duplicate naming another transaction is the same fail-closed mismatch.
    if (cause instanceof ccc.ErrorClientDuplicatedTransaction) {
      if (cause.txHash === txHash) {
        return txHash;
      }
      throw new TransactionBroadcastError(txHash, { nodeTxHash: cause.txHash, cause });
    }
    throw new TransactionBroadcastError(txHash, { cause });
  }

  if (nodeTxHash !== txHash) {
    throw new TransactionBroadcastError(txHash, { nodeTxHash });
  }
  return txHash;
}
