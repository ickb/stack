import { ccc } from "@ckb-ccc/core";
import { ORDER } from "./constants.ts";
import { decodeReceiptData, isReceipt, receiptCell } from "./logic.ts";
import { mintOrderOf } from "./order/order.ts";
import { isOwned, isOwner, OwnerCell } from "./owned_owner.ts";
import { signerAccountLocks } from "./utils/signer.ts";
import { cacheFirstTransaction, headerByNumber } from "./utils/utils.ts";
import { verifiedClient } from "./utils/verified_client.ts";

/**
 * One thing a conversion did for the account, read from what its transaction created.
 * `deposit`: the CKB put into DAO deposits and the iCKB its receipt is worth. `order`: the
 * CKB and iCKB a minted order offers. `withdrawal`: the CKB a withdrawal request holds.
 */
export type HistoryOperation =
  | { kind: "deposit"; ckb: bigint; ickb: bigint }
  | { kind: "order"; ckb: bigint; ickb: bigint }
  | { kind: "withdrawal"; ckb: bigint };

/** A transaction of the account's conversions, newest first: never without an operation. */
export interface HistoryEntry {
  txHash: ccc.Hex;
  /** The block's timestamp, in unix milliseconds. */
  timestamp: bigint;
  operations: HistoryOperation[];
}

/** One index record: a transaction, its place in the chain, and the cells it matched. */
type IndexRecord = ccc.ClientFindTransactionsGroupedResponse["transactions"][number];

/**
 * The account's conversions, newest first, read lazily: a `for await` that breaks stops
 * the reads. Display only: the index records are a node's claim (sdk/docs/history.md).
 *
 * @remarks Every user conversion mints an order, so one scan per account lock, of the
 * transactions that touched an order master at that lock, finds them all. The streams are
 * merged by block and index, a transaction two locks share kept once. A transaction that
 * only spent masters, a collection or a melt, is skipped unread, and the amounts come from
 * the outputs at the account's locks alone.
 */
export async function* readHistory(signer: ccc.Signer): AsyncGenerator<HistoryEntry> {
  const locks = await signerAccountLocks(signer);
  const client = verifiedClient(signer.client);
  const streams = locks.map((lock) =>
    client.findTransactions(
      {
        script: lock,
        scriptType: "lock",
        scriptSearchMode: "exact",
        filter: { script: ORDER },
        groupByTransaction: true,
      },
      "desc",
    ),
  );
  for await (const { txHash, blockNumber, cells } of newestFirst(streams)) {
    if (cells.every(({ isInput }) => isInput)) {
      continue;
    }
    const [response, header] = await Promise.all([
      cacheFirstTransaction(client, txHash),
      headerByNumber(client, blockNumber),
    ]);
    if (response === undefined) {
      throw new Error(`Transaction ${txHash} is indexed but not found`);
    }
    const operations = operationsOf(response.transaction, locks, header, blockNumber);
    if (operations.length > 0) {
      yield { txHash, timestamp: header.timestamp, operations };
    }
  }
}

/**
 * Merges streams that each run newest first into one, a record two streams share kept
 * once. It asks a stream for its next record only once its head is consumed.
 */
async function* newestFirst(
  streams: ReadonlyArray<AsyncGenerator<IndexRecord>>,
): AsyncGenerator<IndexRecord> {
  const next = async (
    stream: AsyncGenerator<IndexRecord>,
  ): Promise<IndexRecord | undefined> => {
    const result = await stream.next();
    return result.done === true ? undefined : result.value;
  };
  const heads = await Promise.all(streams.map(next));
  let last: ccc.Hex | undefined;
  for (;;) {
    // -1 until a stream with a record is found; `heads[-1]` is then undefined.
    let newest = -1;
    for (const [index, head] of heads.entries()) {
      const best = heads[newest];
      if (head !== undefined && (best === undefined || isNewer(head, best))) {
        newest = index;
      }
    }
    const record = heads[newest];
    const stream = streams[newest];
    if (record === undefined || stream === undefined) {
      return;
    }
    // Records sort by block and index, so a transaction two streams share comes twice in a row.
    if (record.txHash !== last) {
      last = record.txHash;
      yield record;
    }
    heads[newest] = await next(stream);
  }
}

function isNewer(left: IndexRecord, right: IndexRecord): boolean {
  return (
    left.blockNumber > right.blockNumber ||
    (left.blockNumber === right.blockNumber && left.txIndex > right.txIndex)
  );
}

/** What the transaction created at the account's locks, a foreign output never counted. */
function operationsOf(
  transaction: ccc.Transaction,
  locks: readonly ccc.Script[],
  header: ccc.ClientBlockHeader,
  blockNumber: ccc.Num,
): HistoryOperation[] {
  const txHash = transaction.hash();
  const outputs = [...transaction.outputCells].map(({ cellOutput, outputData }, index) =>
    ccc.Cell.from({ outPoint: { txHash, index }, cellOutput, outputData }),
  );
  const operations: HistoryOperation[] = [];
  for (const cell of outputs) {
    if (locks.every((lock) => !cell.cellOutput.lock.eq(lock))) {
      continue;
    }
    if (isReceipt(cell)) {
      const { depositQuantity, depositAmount } = decodeReceiptData(cell.outputData);
      operations.push({
        kind: "deposit",
        // Each deposit's free capacity is the amount the receipt records.
        ckb: depositQuantity * depositAmount,
        ickb: receiptCell(cell, header).udtValue,
      });
    } else if (isOwner(cell)) {
      const request = outputs[Number(new OwnerCell(cell).getOwned().index)];
      if (request !== undefined && isOwned(request)) {
        operations.push({ kind: "withdrawal", ckb: request.capacityFree });
      }
    } else if (cell.cellOutput.type?.eq(ORDER) === true) {
      const mint = mintOrderOf(transaction, cell.outPoint, blockNumber);
      if (mint !== undefined) {
        operations.push({ kind: "order", ckb: mint.ckbUnoccupied, ickb: mint.udtValue });
      }
    }
  }
  return operations;
}
