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
 * Verifies the inputs against the chain, signs locally, records chain identity before
 * RPC, then broadcasts without CCC's cache wrapper.
 *
 * @remarks Every input is first checked against its creating transaction, read from the
 * client cache or the node and accepted only when its hash is the one the OutPoint names:
 * the cell the planner attached must equal that transaction's output at the index, else
 * nothing is signed. The connector must not alter the economic body it was handed: the
 * ordered inputs, outputs and outputs data are compared against a digest taken before
 * signing, so in-place mutation cannot evade the check. Witnesses and cell/header
 * dependency preparation stay signer-owned. The fee ceiling values the verified inputs
 * while measuring the signed bytes. When `broadcastBefore` is given, one fresh tip is read
 * after the signature and the fee check, and the send is refused with
 * `TransactionExpiredError` once the tip's epoch has reached it: a withdrawal request that
 * commits after its claim locks the deposit for another cycle, and a wallet may hold the
 * signature for a while.
 * `recordTxHash` is called after these checks and before the send RPC starts. A node that
 * already holds this exact transaction is an acceptance; any other send failure remains
 * ambiguous and throws `TransactionBroadcastError`. The client cache is never marked:
 * later attempts rebuild from exact committed reads.
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
  const inputs = await verifiedInputs(signer.client, requested.inputs);
  const signed = await signer.signTransaction(tx);
  if (economicBody(signed) !== requestedBody) {
    throw new Error("Signer altered the transaction inputs, outputs or outputs data");
  }
  const txHash = signed.hash();
  // CCC values inputs from the metadata attached to them, so the verified cells go in
  // place of whatever the connector-controlled result carries.
  const feeTransaction = signed.clone();
  feeTransaction.inputs = inputs;
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

// The default lock signs each input as its OutPoint only, never the cell behind it, so
// the capacity, lock, type and data attached to an input are a node's claim: a node
// understating a plain cell's capacity or a UDT amount would turn the difference into
// fee or a burn on a transaction that passes every other check. The creating transaction
// certifies itself, since its hash is the hash of its raw body, so the output it holds at
// the OutPoint's index is the real cell.
async function verifiedInputs(
  client: ccc.Client,
  inputs: readonly ccc.CellInput[],
): Promise<ccc.CellInput[]> {
  const transactions = new Map<ccc.Hex, Promise<ccc.Transaction>>();
  return Promise.all(
    inputs.map(async (input) => {
      const { txHash, index } = input.previousOutput;
      let transaction = transactions.get(txHash);
      if (transaction === undefined) {
        transaction = creatingTransaction(client, txHash);
        transactions.set(txHash, transaction);
      }
      const outPoint = input.previousOutput.toHex();
      // The output comes from the parsed body the hash was computed over, so it is the
      // one the hash covers.
      const cell = (await transaction).getOutput(index);
      if (cell === undefined) {
        throw new Error(`Input ${outPoint} is not an output of its transaction`);
      }
      if (
        (input.cellOutput !== undefined && !cell.cellOutput.eq(input.cellOutput)) ||
        (input.outputData !== undefined && input.outputData !== cell.outputData)
      ) {
        throw new Error(
          `Input ${outPoint} differs from the cell its transaction created`,
        );
      }
      return ccc.CellInput.from({
        previousOutput: input.previousOutput,
        since: input.since,
        cellOutput: cell.cellOutput,
        outputData: cell.outputData,
      });
    }),
  );
}

// The cache answers before the node, whatever status it recorded: the hash check makes a
// cached body as good as a fresh one, and CCC's own read asks the node first.
async function creatingTransaction(
  client: ccc.Client,
  txHash: ccc.Hex,
): Promise<ccc.Transaction> {
  const response =
    (await client.cache.getTransactionResponse(txHash)) ??
    (await client.getTransaction(txHash));
  if (response === undefined) {
    throw new Error(`Transaction ${txHash} not found`);
  }
  const { transaction } = response;
  if (transaction.hash() !== txHash) {
    throw new Error(`Transaction ${txHash} was answered with a body of another hash`);
  }
  return transaction;
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
