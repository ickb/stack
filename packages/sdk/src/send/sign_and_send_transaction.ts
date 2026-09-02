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
 * @remarks The connector must not alter the economic body it was handed: the
 * ordered inputs, outputs and outputs data are compared against a digest taken
 * before signing, so in-place mutation cannot evade the check. Witnesses and
 * cell/header dependency preparation stay signer-owned. The fee ceiling values
 * inputs from the pre-sign transaction rather than connector-supplied metadata,
 * while measuring the signed bytes. `recordTxHash` is called after the signed
 * fee-rate guard and before the send RPC starts. A node that already holds this
 * exact transaction is an acceptance; any other send failure remains ambiguous
 * and throws `TransactionBroadcastError`. The client cache is never marked:
 * later attempts rebuild from exact committed reads.
 *
 * @public
 */
export async function signAndSendTransaction(
  signer: ccc.Signer,
  tx: ccc.TransactionLike,
  recordTxHash?: (txHash: ccc.Hex) => void,
): Promise<ccc.Hex> {
  // Transaction.from reuses Transaction instances, which a signer may mutate in place.
  const requested = ccc.Transaction.from(tx).clone();
  const requestedBody = economicBody(requested);
  const signed = await signer.signTransaction(tx);
  if (economicBody(signed) !== requestedBody) {
    throw new Error("Signer altered the transaction inputs, outputs or outputs data");
  }
  const txHash = signed.hash();
  // CCC trusts input cell metadata already attached to the connector-controlled result.
  const feeTransaction = signed.clone();
  feeTransaction.inputs = requested.inputs;
  const feeRate = await feeTransaction.getFeeRate(signer.client);
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

// Hashing a body-only transaction reuses CCC serialization to freeze the ordered
// inputs, outputs and outputs data, while ignoring signer-owned witnesses and
// the cell/header deps a connector may still have to prepare.
function economicBody(tx: ccc.TransactionLike): ccc.Hex {
  const { inputs, outputs, outputsData } = ccc.Transaction.from(tx);
  return ccc.Transaction.from({ inputs, outputs, outputsData }).hash();
}
