import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { unique } from "../utils/utils.ts";

/** Error from a broadcast whose outcome is unknown; the local transaction hash is retained. */
export class TransactionBroadcastError extends Error {
  /** Chain transaction hash computed from the signed transaction before broadcast. */
  public readonly txHash: ccc.Hex;

  /** Creates a hash-preserving broadcast error. */
  constructor(txHash: ccc.Hex, options: ErrorOptions) {
    super(`Transaction ${txHash} broadcast outcome is unresolved`, options);
    this.name = "TransactionBroadcastError";
    this.txHash = txHash;
  }
}

/** Error from a send refused because the chain reached the transaction's broadcast deadline. */
export class TransactionExpiredError extends Error {
  /** The deadline and the tip epoch that reached it. */
  public readonly epochs: { broadcastBefore: ccc.Epoch; tip: ccc.Epoch };

  /** Creates the error for a deadline the tip has reached; nothing was sent. */
  constructor(
    epochs: { broadcastBefore: ccc.Epoch; tip: ccc.Epoch },
    options?: ErrorOptions,
  ) {
    super("Transaction expired: the chain reached its broadcast deadline", options);
    this.name = "TransactionExpiredError";
    this.epochs = epochs;
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
 * while measuring the signed bytes. When `broadcastBefore` is given, one fresh tip
 * is read after the signature and the fee check, and the send is refused with
 * `TransactionExpiredError` once the tip's epoch has reached it: a withdrawal
 * request that commits after its claim locks the deposit for another cycle, and a
 * wallet may hold the signature for a while (decisions amendment 52(al)).
 * `recordTxHash` is called after these checks and before the send RPC starts. A
 * node that already holds this exact transaction is an acceptance; any other send
 * failure remains ambiguous and throws `TransactionBroadcastError`. The client
 * cache is never marked: later attempts rebuild from exact committed reads.
 */
export async function signAndSendTransaction(
  signer: ccc.Signer,
  tx: ccc.TransactionLike,
  recordTxHash?: (txHash: ccc.Hex) => void,
  broadcastBefore?: ccc.Epoch,
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
  if (broadcastBefore !== undefined) {
    const { epoch } = await signer.client.getTipHeader();
    if (broadcastBefore.compare(epoch) <= 0) {
      throw new TransactionExpiredError({ broadcastBefore, tip: epoch });
    }
  }
  recordTxHash?.(txHash);

  // The signature binds the bytes, so the node can only have accepted this exact
  // transaction; its returned hash adds nothing and the local one stays the identity.
  try {
    await signer.client.sendTransactionNoCache(signed);
  } catch (cause) {
    // A duplicate submission of this exact transaction is already accepted.
    if (
      cause instanceof ccc.ErrorClientDuplicatedTransaction &&
      cause.txHash === txHash
    ) {
      return txHash;
    }
    throw new TransactionBroadcastError(txHash, { cause });
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

/**
 * Returns the primary lock plus all signer address locks, deduplicated by script hash.
 */
export async function signerAccountLocks(
  signer: ccc.Signer,
  primaryLock: ccc.Script,
): Promise<ccc.Script[]> {
  return [
    ...unique([
      primaryLock,
      ...(await signer.getAddressObjs()).map(({ script }) => script),
    ]),
  ];
}
