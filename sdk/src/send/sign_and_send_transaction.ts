import { ccc } from "@ckb-ccc/core";
import type { BroadcastDeadline } from "../dao.ts";
import { jsonRpcRequestor, unique } from "../utils/utils.ts";
import { verifiedClient } from "../utils/verified_client.ts";

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
 * @remarks Nothing is signed unless every input equals the output its creating
 * transaction made and the signer kept the ordered inputs, outputs and outputs data.
 * Nothing is sent when the chain would take more fee than `plannedFee`, the fee completion
 * priced, `tx.estimateFee(feeRate)` at its rate. That fee is measured from verified values,
 * a phase-2 DAO input proven in its request block with `get_transaction_proof`, so the
 * client must be JSON-RPC. When `broadcastBefore` is given, the send is refused with
 * `TransactionExpiredError` once a fresh tip reaches it.
 * `recordTxHash` runs before the send RPC. A node already holding this exact transaction
 * is an acceptance; any other send failure throws `TransactionBroadcastError`. Why each
 * check exists: SDK README, Signing and broadcast.
 */
export async function signAndSendTransaction(
  signer: ccc.Signer,
  tx: ccc.TransactionLike,
  plannedFee: ccc.Num,
  recordTxHash?: (txHash: ccc.Hex) => void,
  broadcastBefore?: BroadcastDeadline,
): Promise<ccc.Hex> {
  // Transaction.from reuses Transaction instances, which a signer may mutate in place.
  const requested = ccc.Transaction.from(tx).clone();
  const requestedBody = economicBody(requested);
  // The checks read through a verified client, whatever client the signer holds.
  const client = verifiedClient(signer.client);
  const inputs = await verifiedInputs(client, requested.inputs);
  const signed = await signer.signTransaction(tx);
  if (economicBody(signed) !== requestedBody) {
    throw new Error("Signer altered the transaction inputs, outputs or outputs data");
  }
  const txHash = signed.hash();
  // Completion priced phase-2 interest through the signer's client at whatever header the
  // node named: a lower rate shortens the change, and the miner would keep the difference
  // under any fee-rate ceiling.
  const fee = await verifiedFee(client, signed, inputs);
  if (fee > plannedFee) {
    throw new Error(
      `Transaction ${txHash} pays ${String(fee)} shannons of fee, more than the ${String(plannedFee)} planned`,
    );
  }
  if (broadcastBefore !== undefined) {
    const { epoch } = await verifiedClient(
      signer.client,
      broadcastBefore.tipMaxAgeMs,
    ).getTipHeader();
    if (broadcastBefore.epoch.compare(epoch) <= 0) {
      throw new TransactionExpiredError({
        broadcastBefore: broadcastBefore.epoch,
        tip: epoch,
      });
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
// fee or a burn on a transaction that passes every other check. The verified client reads
// the cell from its creating transaction, whose hash certifies its body.
async function verifiedInputs(
  client: ccc.Client,
  inputs: readonly ccc.CellInput[],
): Promise<ccc.Cell[]> {
  return Promise.all(
    inputs.map(async (input) => {
      const outPoint = input.previousOutput.toHex();
      const cell = await client.getCell(input.previousOutput);
      if (cell === undefined) {
        throw new Error(`Input ${outPoint} is not an output of a known transaction`);
      }
      if (
        (input.cellOutput !== undefined && !cell.cellOutput.eq(input.cellOutput)) ||
        (input.outputData !== undefined && input.outputData !== cell.outputData)
      ) {
        throw new Error(
          `Input ${outPoint} differs from the cell its transaction created`,
        );
      }
      return cell;
    }),
  );
}

// The fee the chain will take: the verified inputs' capacity, plus the interest a phase-2
// DAO input collects, less the outputs. CCC values that
// interest from headers it reads afresh, and a node names which block created a cell;
// the chain values it at headers the transaction names in its deps, the deposit header
// at the number the cell's data records and the request header at the block that
// committed the request, which the node must prove (assertCommittedIn), once per request
// transaction. The deposit header is then the one the cell's data numbers and the request
// header the real request block, so dao.c's own rules settle the rest on chain.
async function verifiedFee(
  client: ccc.Client,
  signed: ccc.Transaction,
  inputs: readonly ccc.Cell[],
): Promise<ccc.Num> {
  const deps = new Set(signed.headerDeps);
  const proven = new Set<string>();
  let capacity = ccc.Zero;
  for (const cell of inputs) {
    capacity += cell.cellOutput.capacity;
    const { depositHeader, withdrawHeader } = await cell.getNervosDaoInfo(client);
    if (withdrawHeader === undefined) {
      continue;
    }
    if (!deps.has(depositHeader.hash) || !deps.has(withdrawHeader.hash)) {
      throw new Error(
        `Input ${cell.outPoint.toHex()} is valued at a header the transaction does not name`,
      );
    }
    const { txHash } = cell.outPoint;
    if (!proven.has(`${txHash}${withdrawHeader.hash}`)) {
      await assertCommittedIn(client, txHash, withdrawHeader);
      proven.add(`${txHash}${withdrawHeader.hash}`);
    }
    capacity += ccc.calcDaoProfit(cell.capacityFree, depositHeader, withdrawHeader);
  }
  return capacity - signed.getOutputsCapacity();
}

/**
 * Refuses unless the node proves `txHash` is among the transactions of `header`'s block.
 * An outpoint names its transaction, not the block that committed it, so a phase-2 input
 * valued at the request header the node names could otherwise be valued at another
 * request block of the same transaction. The proof is a Merkle path from the transaction
 * hash to the header's transactions root, which the header's own hash binds.
 */
async function assertCommittedIn(
  client: ccc.Client,
  txHash: ccc.Hex,
  header: ccc.ClientBlockHeader,
): Promise<void> {
  const requestor = jsonRpcRequestor(client);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- the node's answer, checked field by field in isCommittedIn.
  const proof = (await requestor.request("get_transaction_proof", [
    [txHash],
    header.hash,
  ])) as TransactionProof;
  if (!isCommittedIn(txHash, header, proof)) {
    throw new Error(`Transaction ${txHash} is not proven in block ${header.hash}`);
  }
}

/** The node's `get_transaction_proof` answer for one transaction, the fields checked. */
export interface TransactionProof {
  witnesses_root: ccc.Hex;
  proof: { indices: readonly ccc.Hex[]; lemmas: readonly ccc.Hex[] };
}

/**
 * Whether `proof` is a path from `txHash` to `header`'s transactions root. CKB builds that
 * root over two subtrees, `blake2b(raw transactions root || witnesses root)`, each a
 * complete binary Merkle tree whose node at position `i` has its parent at `(i - 1) / 2`
 * and is a left child when `i` is odd; the index is the leaf's position and the lemmas are
 * its siblings bottom up.
 */
export function isCommittedIn(
  txHash: ccc.Hex,
  header: ccc.ClientBlockHeader,
  { witnesses_root: witnessesRoot, proof }: TransactionProof,
): boolean {
  const [index, ...extra] = proof.indices;
  if (index === undefined || extra.length > 0) {
    return false;
  }
  let node = txHash;
  let position = Number(index);
  for (const lemma of proof.lemmas) {
    if (position === 0) {
      return false;
    }
    node = position % 2 === 1 ? ccc.hashCkb(node, lemma) : ccc.hashCkb(lemma, node);
    position = (position - 1) >> 1;
  }
  return position === 0 && ccc.hashCkb(node, witnessesRoot) === header.transactionsRoot;
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
