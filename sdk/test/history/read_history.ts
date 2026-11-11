import { ccc } from "@ckb-ccc/core";
import type { cccA } from "@ckb-ccc/core/advanced";
import {
  committedTransactionResponse,
  script,
  StubClient,
  type StubTransactionRecord,
} from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { DAO, ICKB_LOGIC, ORDER, OWNED_OWNER } from "../../src/constants.ts";
import { readHistory, type HistoryEntry } from "../../src/history.ts";
import { encodeReceiptData } from "../../src/logic.ts";
import { OrderCell } from "../../src/order/cells.ts";
import { Relative } from "../../src/order/relative.ts";
import { encodeOwnerData } from "../../src/owned_owner.ts";
import {
  directionalInfo,
  makeOrderCell,
} from "../order/matching/support/order_order_helpers.ts";
import { hash, headerLike } from "../transaction/base/support/sdk_core_support.ts";

const USER = script("11");
const SECOND = script("12");
const FOREIGN = script("99");
// At genesis's accumulated rate a CKB of free deposit capacity is worth an iCKB.
const GENESIS_DAO = { c: 0n, ar: 10n ** 16n, s: 0n, u: 0n };
const DEPOSIT_AMOUNT = ccc.fixedPointFrom(1000);

/** A conversion's outputs: what `lock` placed, beside cells no account lock owns. */
function conversion(
  lock: ccc.Script,
  nonce: string,
  parts: { receipt?: boolean; request?: boolean; order?: boolean } = {},
): ccc.Transaction {
  const tx = ccc.Transaction.from({
    // An input of its own keeps each body, and so each hash, apart.
    inputs: [{ previousOutput: { txHash: hash(nonce), index: 0n } }],
  });
  const add = (cellOutput: ccc.CellOutputLike, outputData: ccc.HexLike = "0x"): void => {
    tx.addOutput(cellOutput, outputData);
  };
  add(
    { capacity: ccc.fixedPointFrom(1082), lock: ICKB_LOGIC, type: DAO },
    "0x0000000000000000",
  );
  if (parts.receipt ?? true) {
    add(
      { capacity: ccc.fixedPointFrom(200), lock, type: ICKB_LOGIC },
      encodeReceiptData({ depositQuantity: 2n, depositAmount: DEPOSIT_AMOUNT }),
    );
  }
  if (parts.request ?? true) {
    add(
      { capacity: ccc.fixedPointFrom(500), lock: OWNED_OWNER, type: DAO },
      "0x0500000000000000",
    );
    add(
      { capacity: ccc.fixedPointFrom(100), lock, type: OWNED_OWNER },
      encodeOwnerData({ ownedDistance: -1n }),
    );
  }
  if (parts.order ?? true) {
    const mint = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(300),
      udtValue: 7n,
      info: directionalInfo(),
      master: { type: "relative", value: Relative.create(1n) },
      outPoint: { txHash: hash("00"), index: 0n },
    });
    add(mint.cell.cellOutput, mint.cell.outputData);
    add({ capacity: ccc.fixedPointFrom(74), lock, type: ORDER });
  }
  // A receipt at a lock the account doesn't hold: never counted.
  add(
    { capacity: ccc.fixedPointFrom(200), lock: FOREIGN, type: ICKB_LOGIC },
    encodeReceiptData({ depositQuantity: 1n, depositAmount: 1n }),
  );
  return tx;
}

/** The record the index gives for `tx` at `blockNumber`, its matched cells outputs unless said. */
function record(
  tx: ccc.Transaction,
  blockNumber: bigint,
  txIndex: bigint,
  isInput = false,
  cells = [{ isInput, cellIndex: 0n }],
): StubTransactionRecord {
  return { txHash: tx.hash(), blockNumber, txIndex, cells };
}

/** A two-address signer over a node serving these index records, bodies and headers. */
function history(
  records: Map<ccc.Script, StubTransactionRecord[]>,
  bodies: ccc.Transaction[],
  cache?: ccc.ClientCache,
): {
  signer: ccc.Signer;
  pages: Array<{ key: cccA.JsonRpcIndexerSearchKey; order: string }>;
  bodyReads: ccc.Hex[];
  headerReads: ccc.Num[];
} {
  const pages: Array<{ key: cccA.JsonRpcIndexerSearchKey; order: string }> = [];
  const bodyReads: ccc.Hex[] = [];
  const headerReads: ccc.Num[] = [];
  const client = new StubClient({
    ...(cache === undefined ? {} : { cache }),
    transactions: (key, order): readonly StubTransactionRecord[] => {
      const lock = ccc.Script.from({
        codeHash: key.script.code_hash,
        hashType: key.script.hash_type,
        args: key.script.args,
      });
      pages.push({ key, order });
      return [...records].find(([candidate]) => candidate.eq(lock))?.[1] ?? [];
    },
    getTransaction: async (txHash): ReturnType<ccc.Client["getTransaction"]> => {
      bodyReads.push(ccc.hexFrom(txHash));
      await Promise.resolve();
      const body = bodies.find((tx) => tx.hash() === ccc.hexFrom(txHash));
      return body === undefined ? undefined : committedTransactionResponse(body);
    },
    getHeaderByNumber: async (number): ReturnType<ccc.Client["getHeaderByNumber"]> => {
      headerReads.push(ccc.numFrom(number));
      await Promise.resolve();
      return headerLike(ccc.numFrom(number), {
        timestamp: 1000n * ccc.numFrom(number),
        dao: GENESIS_DAO,
      });
    },
  });
  return {
    signer: new ccc.SignerCkbScriptReadonly(client, [USER, SECOND]),
    pages,
    bodyReads,
    headerReads,
  };
}

async function all(signer: ccc.Signer): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = [];
  for await (const entry of readHistory(signer)) {
    entries.push(entry);
  }
  return entries;
}

describe("readHistory", () => {
  it("reads a conversion's deposit, withdrawal and order from its outputs at the account", async () => {
    const tx = conversion(USER, "a1");
    const { signer } = history(new Map([[USER, [record(tx, 5n, 0n)]]]), [tx]);
    const output = (index: number): ccc.Cell => {
      const { cellOutput, outputData } = [...tx.outputCells][index] ?? {};
      if (cellOutput === undefined || outputData === undefined) {
        throw new Error(`No output ${String(index)}`);
      }
      return ccc.Cell.from({
        outPoint: { txHash: tx.hash(), index },
        cellOutput,
        outputData,
      });
    };

    await expect(all(signer)).resolves.toEqual([
      {
        txHash: tx.hash(),
        timestamp: 5000n,
        operations: [
          // Two deposits of the recorded free capacity, worth as many iCKB at genesis.
          { kind: "deposit", ckb: 2n * DEPOSIT_AMOUNT, ickb: 2n * DEPOSIT_AMOUNT },
          { kind: "withdrawal", ckb: output(2).capacityFree },
          {
            kind: "order",
            ckb: OrderCell.mustFrom(output(4), 5n).ckbUnoccupied,
            ickb: 7n,
          },
        ],
      },
    ]);
  });

  it("merges the addresses newest first, a block's transactions by their index", async () => {
    const newest = conversion(USER, "b1");
    const later = conversion(SECOND, "b2");
    const earlier = conversion(USER, "b3");
    const { signer } = history(
      new Map([
        [USER, [record(newest, 7n, 0n), record(earlier, 5n, 2n)]],
        [SECOND, [record(later, 5n, 3n)]],
      ]),
      [newest, later, earlier],
    );

    const entries = await all(signer);

    expect(entries.map(({ txHash }) => txHash)).toEqual(
      [newest, later, earlier].map((tx) => tx.hash()),
    );
  });

  it("asks the index for each lock's order-master transactions, newest first", async () => {
    const { signer, pages } = history(new Map(), []);

    await all(signer);

    expect(pages).toEqual(
      [USER, SECOND].map((lock) => ({
        key: {
          script: { code_hash: lock.codeHash, hash_type: lock.hashType, args: lock.args },
          script_type: "lock",
          script_search_mode: "exact",
          filter: {
            script: {
              code_hash: ORDER.codeHash,
              hash_type: ORDER.hashType,
              args: ORDER.args,
            },
          },
          group_by_transaction: true,
        },
        order: "desc",
      })),
    );
  });

  it("orders a newer block first whichever address leads", async () => {
    const newest = conversion(SECOND, "b4");
    const later = conversion(USER, "b5");
    const earlier = conversion(SECOND, "b6");
    const { signer } = history(
      new Map([
        [USER, [record(later, 5n, 3n)]],
        [SECOND, [record(newest, 7n, 0n), record(earlier, 5n, 2n)]],
      ]),
      [newest, later, earlier],
    );

    const entries = await all(signer);

    expect(entries.map(({ txHash }) => txHash)).toEqual(
      [newest, later, earlier].map((tx) => tx.hash()),
    );
  });

  it("reads a transaction that spent a master and made one", async () => {
    const update = conversion(USER, "c2");
    const { signer } = history(
      new Map([
        [
          USER,
          [
            record(update, 5n, 0n, false, [
              { isInput: true, cellIndex: 0n },
              { isInput: false, cellIndex: 0n },
            ]),
          ],
        ],
      ]),
      [update],
    );

    await expect(all(signer)).resolves.toHaveLength(1);
  });

  it("keeps a transaction two addresses share once, with what it made for each", async () => {
    // One transaction placing an order at the first address and a deposit at the second.
    const shared = conversion(USER, "c1", { receipt: false, request: false });
    shared.addOutput(
      { capacity: ccc.fixedPointFrom(200), lock: SECOND, type: ICKB_LOGIC },
      encodeReceiptData({ depositQuantity: 1n, depositAmount: DEPOSIT_AMOUNT }),
    );
    const { signer } = history(
      new Map([
        [USER, [record(shared, 5n, 0n)]],
        [SECOND, [record(shared, 5n, 0n)]],
      ]),
      [shared],
    );

    const entries = await all(signer);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.operations.map(({ kind }) => kind)).toEqual(["order", "deposit"]);
  });

  it("keeps a conversion whose first-listed lock only spent a master", async () => {
    // The first lock's master is melted, an input; the new one goes to the second, an output.
    const tx = conversion(SECOND, "c9", { receipt: false, request: false });
    const { signer } = history(
      new Map([
        [USER, [record(tx, 5n, 0n, true)]],
        [SECOND, [record(tx, 5n, 0n)]],
      ]),
      [tx],
    );

    const entries = await all(signer);

    expect(entries.map(({ txHash }) => txHash)).toEqual([tx.hash()]);
  });

  it("skips, reading nothing, a transaction that only spent the account's masters", async () => {
    const melt = conversion(USER, "d1");
    const { signer, bodyReads, headerReads } = history(
      new Map([[USER, [record(melt, 5n, 0n, true)]]]),
      [melt],
    );

    await expect(all(signer)).resolves.toEqual([]);
    expect(bodyReads).toEqual([]);
    expect(headerReads).toEqual([]);
  });

  it("skips a transaction that made nothing to report at the account", async () => {
    // The index matched an output, but nothing at the account's locks is a conversion.
    const nothing = conversion(USER, "e1", {
      receipt: false,
      request: false,
      order: false,
    });
    const { signer } = history(new Map([[USER, [record(nothing, 5n, 0n)]]]), [nothing]);

    await expect(all(signer)).resolves.toEqual([]);
  });

  it("counts no withdrawal or order a marker or master doesn't lead to", async () => {
    // A body the node claims, its hash checked but never the chain's: plain change, an
    // owner marker naming a plain cell, another naming no output, a master beside no mint.
    const odd = conversion(USER, "e2", { receipt: false, request: false, order: false });
    odd.addOutput({ capacity: ccc.fixedPointFrom(100), lock: USER });
    odd.addOutput({ capacity: ccc.fixedPointFrom(100), lock: FOREIGN });
    odd.addOutput(
      { capacity: ccc.fixedPointFrom(100), lock: USER, type: OWNED_OWNER },
      encodeOwnerData({ ownedDistance: -1n }),
    );
    odd.addOutput(
      { capacity: ccc.fixedPointFrom(100), lock: USER, type: OWNED_OWNER },
      encodeOwnerData({ ownedDistance: 9n }),
    );
    odd.addOutput({ capacity: ccc.fixedPointFrom(74), lock: USER, type: ORDER });
    const { signer } = history(new Map([[USER, [record(odd, 5n, 0n)]]]), [odd]);

    await expect(all(signer)).resolves.toEqual([]);
  });

  it("stops reading when the caller stops: one page per address for the first entry", async () => {
    const bodies = Array.from({ length: 11 }, (_, index) =>
      conversion(USER, (0xf0 + index).toString(16)),
    );
    const { signer, pages } = history(
      new Map([
        [USER, bodies.map((tx, index) => record(tx, BigInt(100 - index), 0n))],
        [SECOND, bodies.map((tx, index) => record(tx, BigInt(50 - index), 0n))],
      ]),
      bodies,
    );

    for await (const entry of readHistory(signer)) {
      expect(entry.txHash).toBe(bodies[0]?.hash());
      break;
    }

    // CCC asks for ten records a page, so a second page would mean eleven were read.
    expect(pages).toHaveLength(2);
  });

  it("reads one header for two conversions in one block", async () => {
    const first = conversion(USER, "a2");
    const second = conversion(USER, "a3");
    const { signer, headerReads } = history(
      new Map([[USER, [record(first, 5n, 1n), record(second, 5n, 0n)]]]),
      [first, second],
    );

    await expect(all(signer)).resolves.toHaveLength(2);
    expect(headerReads).toEqual([5n]);
  });

  it("refuses a cached body filed under a hash it does not have", async () => {
    // A consumer's cache that files bodies under the hash asked for, unlike CCC's own.
    const named = conversion(USER, "a5");
    const forged = conversion(USER, "a6");
    class MisfilingCache extends ccc.ClientCacheMemory {
      public override async getTransactionResponse(): Promise<ccc.ClientTransactionResponse> {
        await Promise.resolve();
        return committedTransactionResponse(forged);
      }
    }
    const { signer } = history(
      new Map([[USER, [record(named, 5n, 0n)]]]),
      [named],
      new MisfilingCache(),
    );

    await expect(all(signer)).rejects.toThrow(
      `Transaction ${named.hash()} was answered with a body of another hash`,
    );
  });

  it("refuses an indexed transaction the node cannot serve", async () => {
    const lost = conversion(USER, "a4");
    const { signer } = history(new Map([[USER, [record(lost, 5n, 0n)]]]), []);

    await expect(all(signer)).rejects.toThrow(
      `Transaction ${lost.hash()} is indexed but not found`,
    );
  });
});
