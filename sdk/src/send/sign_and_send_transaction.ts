import { ccc } from "@ckb-ccc/core";
import { assertFresh, type BroadcastDeadline } from "../dao.ts";
import { jsonRpcRequestor } from "../utils/utils.ts";
import { verifiedClient } from "../utils/verified_client.ts";

/**
 * A send's outcome. `not-signed`: the signer refused or failed to sign, its rejection the
 * `cause`. `expired`: the chain reached the broadcast deadline; nothing was sent.
 * `maybe-sent`: the broadcast failed without saying whether the node took the transaction,
 * so `txHash` is the one to watch, never to resend.
 */
export type SignAndSendTransactionResult =
  | { ok: true; txHash: ccc.Hex }
  | { ok: false; reason: "not-signed"; cause: unknown }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "maybe-sent"; txHash: ccc.Hex; cause: unknown };

/**
 * Verifies the inputs against the chain, signs locally, then broadcasts without CCC's
 * cache wrapper.
 *
 * @remarks Nothing is signed unless every cell attached to an input equals the output
 * its creating transaction made, a bare `OutPoint` being valued from that output, and the
 * signer kept the ordered inputs, outputs and outputs data.
 * Nothing is sent when the chain would take more fee than `plannedFee`, the fee completion
 * priced. That fee is measured from verified values, a phase-2 DAO input proven in its
 * request block with `get_transaction_proof`, so the client must be JSON-RPC. When
 * `broadcastBefore` is given, the send returns `expired` once a fresh tip reaches it.
 * Passing the whole build result keeps that deadline: a built conversion returns all three
 * fields. A node already holding this exact transaction is an acceptance; any other send
 * failure returns `maybe-sent` with the hash, for a send that may never answer. Only the
 * signature is caught: preparing the transaction reads nodes and services, and it and every
 * check here throw as defects. Why each check exists: sdk/docs/signing_and_broadcast.md.
 */
export async function signAndSendTransaction(
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
): Promise<SignAndSendTransactionResult> {
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
    return { ok: false, reason: "not-signed", cause };
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
  if (broadcastBefore !== undefined) {
    const tip = await client.getTipHeader();
    assertFresh(tip, broadcastBefore.tipMaxAgeMs);
    if (broadcastBefore.epoch.compare(tip.epoch) <= 0) {
      return { ok: false, reason: "expired" };
    }
  }

  // The signature binds the bytes, so the node can only have accepted this exact
  // transaction; its returned hash adds nothing and the local one stays the identity.
  try {
    await signer.client.sendTransactionNoCache(signed);
  } catch (cause) {
    // A duplicate submission of this exact transaction is already accepted.
    return isDuplicateOf(cause, txHash)
      ? { ok: true, txHash }
      : { ok: false, reason: "maybe-sent", txHash, cause };
  }
  return { ok: true, txHash };
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
