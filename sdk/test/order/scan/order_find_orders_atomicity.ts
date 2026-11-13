import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, genesisHeader, StubClient, type StubCell } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { findOrders } from "../../../src/order/order.ts";
import { Relative } from "../../../src/order/relative.ts";
import { verifiedClient } from "../../../src/utils/verified_client.ts";
import type {
  GetTransactionHash,
  GetTransactionReturn,
} from "../fixtures/order_constants.ts";
import {
  directionalInfo,
  makeOrderCell,
} from "../matching/support/order_order_helpers.ts";
import {
  masterCell,
  transactionResponse,
  transactionWithOutputs,
} from "./support/order_scan_helpers.ts";

const ORIGIN_LOOKUP_FAILURE = "origin lookup failed";

describe("findOrders resolution atomicity", () => {
  it("resolves every scanned group", async () => {
    const { client } = twoGroupScan({ failingMasterTxHash: undefined });

    const groups = await findOrders(client);

    expect(groups).toHaveLength(2);
  });

  it("yields no group when a later origin lookup fails", async () => {
    const { client, secondMasterTxHash } = twoGroupScan({
      failingMasterTxHash: undefined,
    });
    const { client: failingClient } = twoGroupScan({
      failingMasterTxHash: secondMasterTxHash,
    });
    await expect(findOrders(failingClient)).rejects.toThrow(ORIGIN_LOOKUP_FAILURE);
    await expect(findOrders(client)).resolves.toHaveLength(2);
  });
});

describe("findOrders mint headers", () => {
  it("reads one header for two groups minted in one block, through the verified client", async () => {
    // Bodies hashed for real, since the verified client checks each against its hash.
    const groups = [mintedInGenesis(100, "72"), mintedInGenesis(101, "74")];
    const headerReads: ccc.Num[] = [];
    const client = verifiedClient(
      new StubClient({
        cells: (query): readonly StubCell[] =>
          groups.map(({ liveOrder, liveMaster }) => ({
            cell: query.script_type === "lock" ? liveOrder : liveMaster,
            blockNumber: 0n,
          })),
        getTransaction: async (txHash: GetTransactionHash): GetTransactionReturn => {
          await Promise.resolve();
          const group = groups.find(
            ({ masterTransaction }) => masterTransaction.hash() === ccc.hexFrom(txHash),
          );
          return group === undefined
            ? undefined
            : transactionResponse(group.masterTransaction);
        },
        getHeaderByNumber: async (
          number,
        ): ReturnType<ccc.Client["getHeaderByNumber"]> => {
          headerReads.push(ccc.numFrom(number));
          await Promise.resolve();
          return genesisHeader("testnet");
        },
      }),
    );

    const found = await findOrders(client);

    expect(found.map(({ header }) => header)).toEqual([
      genesisHeader("testnet"),
      genesisHeader("testnet"),
    ]);
    expect(headerReads).toEqual([0n]);
  });
});

/** A group whose master and mint a real-hashed body created; `ckb` keeps bodies apart. */
function mintedInGenesis(ckb: number, liveOrderByte: string): GroupFixture {
  const mint = makeOrderCell({
    ckbUnoccupied: ccc.fixedPointFrom(ckb),
    udtValue: 0n,
    info: directionalInfo(),
    master: { type: "relative", value: Relative.create(1n) },
    outPoint: { txHash: byte32FromByte("00"), index: 0n },
  });
  const masterTransaction = transactionWithOutputs([
    mint.cell,
    masterCell({ txHash: byte32FromByte("00"), index: 1n }),
  ]);
  const master = { txHash: masterTransaction.hash(), index: 1n };
  const liveOrder = makeOrderCell({
    ckbUnoccupied: ccc.fixedPointFrom(ckb),
    udtValue: 0n,
    info: directionalInfo(),
    master: { type: "absolute", value: master },
    outPoint: { txHash: byte32FromByte(liveOrderByte), index: 0n },
  });
  return {
    liveOrder: liveOrder.cell,
    liveMaster: masterCell(master),
    masterTxHash: master.txHash,
    masterTransaction,
  };
}

interface GroupFixture {
  liveOrder: ccc.Cell;
  liveMaster: ccc.Cell;
  masterTxHash: ccc.Hex;
  masterTransaction: ccc.Transaction;
}

function twoGroupScan({
  failingMasterTxHash,
}: {
  failingMasterTxHash: ccc.Hex | undefined;
}): {
  client: ccc.Client;
  secondMasterTxHash: ccc.Hex;
} {
  const first = groupFixture("71", "72");
  const second = groupFixture("73", "74");
  const transactions = new Map([
    [first.masterTxHash, first.masterTransaction],
    [second.masterTxHash, second.masterTransaction],
  ]);
  const client = new StubClient({
    cache: new ccc.ClientCacheMemory(),
    cells: (query): readonly StubCell[] =>
      query.script_type === "lock"
        ? [first.liveOrder, second.liveOrder]
        : [first.liveMaster, second.liveMaster],
    getTransaction: async (txHash: GetTransactionHash): GetTransactionReturn => {
      await Promise.resolve();
      const requested = ccc.hexFrom(txHash);
      if (requested === failingMasterTxHash) {
        throw new Error(ORIGIN_LOOKUP_FAILURE);
      }
      const transaction = transactions.get(requested);
      return transaction === undefined ? undefined : transactionResponse(transaction);
    },
  });
  return { client, secondMasterTxHash: second.masterTxHash };
}

function groupFixture(masterByte: string, liveOrderByte: string): GroupFixture {
  const master = { txHash: byte32FromByte(masterByte), index: 1n };
  const origin = makeOrderCell({
    ckbUnoccupied: ccc.fixedPointFrom(100),
    udtValue: 0n,
    info: directionalInfo(),
    master: { type: "relative", value: Relative.create(1n) },
    outPoint: { txHash: master.txHash, index: 0n },
  });
  const liveOrder = makeOrderCell({
    ckbUnoccupied: ccc.fixedPointFrom(100),
    udtValue: 0n,
    info: directionalInfo(),
    master: { type: "absolute", value: master },
    outPoint: { txHash: byte32FromByte(liveOrderByte), index: 0n },
  });
  const liveMaster = masterCell(master);
  return {
    liveOrder: liveOrder.cell,
    liveMaster,
    masterTxHash: master.txHash,
    masterTransaction: transactionWithOutputs([origin.cell, liveMaster]),
  };
}
