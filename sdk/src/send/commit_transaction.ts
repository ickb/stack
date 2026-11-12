import { ccc } from "@ckb-ccc/core";
import { assertFresh, type BroadcastDeadline } from "../dao.ts";
import { jsonRpcRequestor } from "../utils/utils.ts";
import { verifiedClient } from "../utils/verified_client.ts";

/** The least time between two steps after `sent`, in milliseconds. */
const STEP_INTERVAL_MS = 10_000;

/**
 * One step of a commit. `committed` and every `ok: false` step are last.
 *
 * @remarks `txHash` is the signed transaction, or the prepared one on `not-signed`.
 * `sent`: the first step after signing, once; a `cause` says the first broadcast got no
 * clear answer or was refused. `pending`: neither committed nor rejected yet; a `cause` is
 * the read or broadcast that failed during this step. `committed`: at depth zero.
 * `not-signed`: the signer refused or failed to sign, its rejection the `cause`.
 * `expired`: the tip reached the broadcast deadline first; nothing was sent. `abandoned`:
 * no node answer ever acknowledged the transaction and the tip reached the deadline, so it
 * isn't broadcast again; `cause` is the last broadcast failure. `rejected`: the node
 * rejected it, its recorded reason the `cause`, or refused its last broadcast and still
 * doesn't know it, that refusal the `cause`.
 */
export type CommitStep = { txHash: ccc.Hex; cause?: Error } & (
  | { ok: true; status: "sent" | "pending" | "committed" }
  | { ok: false; reason: "not-signed" | "expired" | "abandoned" | "rejected" }
);

/**
 * Verifies the inputs against the chain, signs locally, broadcasts without CCC's cache
 * wrapper, then watches the transaction until it commits or fails, one step per `next()`.
 *
 * @remarks Nothing is signed unless every cell attached to an input equals the output
 * its creating transaction made, a bare `OutPoint` being valued from that output, and the
 * signer kept the ordered inputs, outputs and outputs data.
 * Nothing is sent when the chain would take more fee than `plannedFee`, the fee completion
 * priced. That fee is measured from verified values, a phase-2 DAO input proven in its
 * request block with `get_transaction_proof`, and the status is read with raw
 * `get_transaction`, so the client must be JSON-RPC; another client throws before the
 * signer is asked. When `broadcastBefore` is given, the commit ends `expired` once a fresh
 * tip reaches it. Passing the whole build result keeps that deadline: a built conversion
 * returns all three fields. Until the broadcast, only the signature is caught: preparing
 * the transaction reads nodes and services, and it and every check throw as defects.
 * After the broadcast nothing throws, since the outcome exists on chain: a failed read
 * is a `pending` step with its `cause`, retried at the next step.
 * Each step after `sent` waits what is left of 10 seconds since the previous one, then
 * reads the status. A transaction the node doesn't know is broadcast again, the same signed
 * bytes, until a node answer acknowledges it or the deadline passes; once acknowledged,
 * it is only watched. The generator is lazy and holds no timer between steps, so a
 * caller's `break` stops it. Nothing here marks the client cache. Why each check exists:
 * sdk/docs/signing_and_broadcast.md.
 */
export async function* commitTransaction(
  signer: ccc.Signer,
  {
    tx,
    plannedFee,
    broadcastBefore,
  }: {
    tx: ccc.TransactionLike;
    plannedFee: ccc.Num;
    broadcastBefore?: BroadcastDeadline;
  },
): AsyncGenerator<CommitStep, void, undefined> {
  // The status reads need it, so a client without one fails before the wallet prompt.
  const requestor = jsonRpcRequestor(signer.client);
  // Transaction.from reuses Transaction instances, which a signer may mutate in place.
  const requested = ccc.Transaction.from(tx).clone();
  const requestedBody = economicBody(requested);
  // The checks read through a verified client, whatever client the signer holds.
  const client = verifiedClient(signer.client);
  const inputs = await verifiedInputs(client, requested.inputs);
  // CCC's signTransaction is these two calls; split, so that only a refused signature is
  // an outcome.
  const prepared = await signer.prepareTransaction(tx);
  let signed: ccc.Transaction;
  try {
    signed = await signer.signOnlyTransaction(prepared);
  } catch (cause) {
    yield {
      ok: false,
      reason: "not-signed",
      txHash: prepared.hash(),
      cause: asError(cause),
    };
    return;
  }
  if (economicBody(signed) !== requestedBody) {
    throw new Error("Signer altered the transaction inputs, outputs or outputs data");
  }
  const txHash = signed.hash();
  const fee = await verifiedFee(client, signed, inputs);
  // A plain JavaScript caller can leave the fee out: numFrom throws on undefined, where a
  // bare comparison of a bigint with it is false and would skip the check.
  const planned = ccc.numFrom(plannedFee);
  if (fee > planned) {
    throw new Error(
      `Transaction ${txHash} pays ${String(fee)} shannons of fee, more than the ${String(planned)} planned`,
    );
  }
  if (broadcastBefore !== undefined && (await reached(client, broadcastBefore))) {
    yield { ok: false, reason: "expired", txHash };
    return;
  }

  let answer = await broadcast(signer.client, signed, txHash);
  let yieldedAt = Date.now();
  yield { ok: true, status: "sent", txHash, cause: answer.cause };

  // One status read and what follows from it.
  const settle = async (): Promise<CommitStep> => {
    // Raw verbosity-1 polling keeps a status-only rejection that CCC's typed transaction
    // response discards (its body is null, so CCC returns nothing).
    const { status, reason } = rawTransactionStatus(
      await requestor.request("get_transaction", [txHash, "0x1"]),
    );
    if (status === "committed") {
      return { ok: true, status, txHash };
    }
    if (status === "rejected") {
      const cause = reason === undefined ? undefined : new Error(reason);
      return { ok: false, reason: "rejected", txHash, cause };
    }
    if (status === "pending" || status === "proposed") {
      // The node holds it, which acknowledges it as an accepted broadcast would.
      answer = {};
      return { ok: true, status: "pending", txHash };
    }
    if (status !== "unknown") {
      throw new Error(`The node gave no known status for transaction ${txHash}`);
    }
    // Once acknowledged, the transaction is only watched, never sent again: a fallback
    // backend that never saw it could refuse it for its own pool and record that, then
    // answer rejected while another backend commits it.
    if (answer.cause === undefined) {
      return { ok: true, status: "pending", txHash };
    }
    if (answer.refused === true) {
      return { ok: false, reason: "rejected", txHash, cause: answer.cause };
    }
    if (broadcastBefore !== undefined && (await reached(client, broadcastBefore))) {
      return { ok: false, reason: "abandoned", txHash, cause: answer.cause };
    }
    answer = await broadcast(signer.client, signed, txHash);
    return { ok: true, status: "pending", txHash, cause: answer.cause };
  };

  for (;;) {
    // Only the rest of the interval: a caller that held the last step already waited.
    await sleep(yieldedAt + STEP_INTERVAL_MS - Date.now());
    let step: CommitStep;
    try {
      step = await settle();
    } catch (error) {
      step = { ok: true, status: "pending", txHash, cause: asError(error) };
    }
    yieldedAt = Date.now();
    yield step;
    if (!step.ok || step.status === "committed") {
      return;
    }
  }
}

/** Whether a fresh tip has reached `deadline`; a tip older than its bound throws. */
async function reached(
  client: ccc.Client,
  { epoch, tipMaxAgeMs }: BroadcastDeadline,
): Promise<boolean> {
  const tip = await client.getTipHeader();
  assertFresh(tip, tipMaxAgeMs);
  return epoch.compare(tip.epoch) <= 0;
}

/** A broadcast's answer: no `cause` when the node took it, else the failure. */
interface Answer {
  cause?: Error;
  refused?: boolean;
}

// The signature binds the bytes, so the node can only have accepted this exact
// transaction; its returned hash adds nothing and the local one stays the identity.
async function broadcast(
  client: ccc.Client,
  signed: ccc.Transaction,
  txHash: ccc.Hex,
): Promise<Answer> {
  try {
    await client.sendTransactionNoCache(signed);
  } catch (cause) {
    // A duplicate submission of this exact transaction is already accepted.
    if (!isDuplicateOf(cause, txHash)) {
      return { cause: asError(cause), refused: isRefusal(cause) };
    }
  }
  return {};
}

/**
 * Whether a send failure is the node refusing the transaction, by the shape of any copy of
 * CCC's client error: CKB's codes (rpc/src/error.rs) -301, an input it can't resolve,
 * -302, a failed verification, and -1100 to -1199, the pool's refusals, except -1107, a
 * duplicate it holds. Any other failure, a transport error or timeout included, says
 * nothing about whether the node took it.
 */
function isRefusal(cause: unknown): boolean {
  if (
    typeof cause !== "object" ||
    cause === null ||
    !("code" in cause) ||
    typeof cause.code !== "number"
  ) {
    return false;
  }
  const { code } = cause;
  return (
    code === -301 || code === -302 || (code <= -1100 && code >= -1199 && code !== -1107)
  );
}

// A step's cause is always an Error, so a caller handles one kind; anything else thrown
// is wrapped, kept as the wrapper's cause.
function asError(thrown: unknown): Error {
  if (thrown instanceof Error) {
    return thrown;
  }
  const message =
    typeof thrown === "object" &&
    thrown !== null &&
    "message" in thrown &&
    typeof thrown.message === "string"
      ? thrown.message
      : String(thrown);
  return new Error(message, { cause: thrown });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether a send failure is CCC's duplicate answer naming this transaction, by shape: the
 * signer's client may come from another copy of CCC, whose `ErrorClientDuplicatedTransaction`
 * `instanceof` against this one misses. Among CCC errors, only that one carries a `txHash`.
 */
export function isDuplicateOf(
  cause: unknown,
  txHash: ccc.Hex,
): cause is Pick<ccc.ErrorClientDuplicatedTransaction, "txHash"> {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "txHash" in cause &&
    cause.txHash === txHash
  );
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
// DAO input collects, less the outputs. Completion priced that interest through the
// signer's client at whatever header the node named, so a lower rate there shortened the
// change; the miner would keep the difference under any fee-rate ceiling. A node names
// which block created a cell; the chain values it at headers the transaction names in its
// deps, the deposit header at the number the cell's data records and the request header
// at the block that committed the request, which the node must prove
// (assertCommittedIn), once per request transaction. The deposit header is then the one
// the cell's data numbers and the request header the real request block, so dao.c's own
// rules settle the rest on chain.
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
  // A path with lemmas past the root walks to -1 and stays there, failing the last check.
  for (const lemma of proof.lemmas) {
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

/** A node's raw `get_transaction` status record (verbosity 1), the fields read here. */
function rawTransactionStatus(response: unknown): {
  status: string | undefined;
  reason: string | undefined;
} {
  const record =
    typeof response === "object" &&
    response !== null &&
    "tx_status" in response &&
    typeof response.tx_status === "object" &&
    response.tx_status !== null
      ? response.tx_status
      : {};
  return {
    status:
      // A status that is not a string matches neither "rejected" nor "committed" either.
      // Stryker disable next-line ConditionalExpression,LogicalOperator: see above.
      "status" in record && typeof record.status === "string" ? record.status : undefined,
    reason:
      "reason" in record && typeof record.reason === "string" ? record.reason : undefined,
  };
}
