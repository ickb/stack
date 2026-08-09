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
 * Signs locally, records chain identity before RPC, broadcasts without CCC's
 * cache wrapper, then marks the accepted transaction in the same client cache.
 *
 * @remarks `recordTxHash` is called after the signed fee-rate guard and before
 * the send RPC starts. A send failure remains ambiguous and throws
 * `TransactionBroadcastError`; a post-acceptance cache failure does not discard
 * the accepted transaction hash.
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
    throw new TransactionBroadcastError(txHash, { cause });
  }

  if (nodeTxHash !== txHash) {
    throw new TransactionBroadcastError(txHash, { nodeTxHash });
  }

  try {
    await signer.client.cache.markTransactions(signed);
  } catch {
    // Node acceptance and the locally computed hash remain authoritative.
  }
  return txHash;
}
