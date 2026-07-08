import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { Info } from "../../src/model/info.ts";
import { OrderData } from "../../src/model/order_data.ts";
import { Relative } from "../../src/model/relative.ts";
import {
  ORDER_MANAGER_FIND_ORDERS_SUITE,
  type FindCellsOnChainQuery,
  type FindCellsOnChainReturn,
  type GetTransactionReturn,
} from "../fixtures/order_constants.ts";
import {
  directionalInfo,
  makeOrderCell,
} from "../matching/support/order_order_helpers.ts";
import {
  collectOrders,
  collectSkippedOrders,
  findOrdersFixture,
  masterCell,
  originLookupClient,
  transactionResponse,
  transactionWithOutputs,
} from "./support/order_scan_helpers.ts";

const MISSING_ORIGIN = "missing-origin";

describe(ORDER_MANAGER_FIND_ORDERS_SUITE, () => {
  it("findOrigin skips parseable non-mint origins in the master transaction", async () => {
    const { manager, orderScript, ownerLock } = findOrdersFixture();
    const originMaster = { txHash: byte32FromByte("55"), index: 2n };
    const forgedOrigin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(200),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "absolute", value: originMaster },
      lock: orderScript,
      outPoint: { txHash: originMaster.txHash, index: 1n },
    });
    const trueOrigin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: {
        type: "relative",
        value: Relative.create(2n),
      },
      outPoint: { txHash: originMaster.txHash, index: 0n },
    });
    const liveOrder = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "absolute", value: originMaster },
      lock: orderScript,
      outPoint: { txHash: byte32FromByte("56"), index: 0n },
    });
    const liveMaster = masterCell(originMaster, orderScript, ownerLock);
    const tx = transactionWithOutputs([trueOrigin.cell, forgedOrigin.cell, liveMaster]);
    const client = originLookupClient({
      liveOrder: liveOrder.cell,
      liveMaster,
      originMasterTxHash: originMaster.txHash,
      originTransaction: tx,
    });

    expect(trueOrigin.data.master.type).toBe("relative");
    if (trueOrigin.data.master.type !== "relative") {
      throw new Error("Expected relative master");
    }
    expect(trueOrigin.data.master.value.distance).toBe(2n);
    expect(trueOrigin.getMaster().eq(originMaster)).toBe(true);
    const groups = await collectOrders(manager, client);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.origin.cell.outPoint.eq(trueOrigin.cell.outPoint)).toBe(true);
  });

  it("round-trips non-zero relative master distances", () => {
    const encoded = OrderData.from({
      udtValue: 0n,
      master: {
        type: "relative",
        value: Relative.create(2n),
      },
      info: directionalInfo(),
    }).toBytes();

    const decoded = OrderData.decode(encoded);

    expect(decoded.master.type).toBe("relative");
    if (decoded.master.type !== "relative") {
      throw new Error("Expected relative master");
    }
    expect(decoded.master.value.distance).toBe(2n);
  });
});

describe(ORDER_MANAGER_FIND_ORDERS_SUITE, () => {
  it("findOrigin requires a minted origin in the master transaction", async () => {
    const { manager, orderScript, ownerLock } = findOrdersFixture();
    const originMaster = { txHash: byte32FromByte("65"), index: 1n };
    const fakeOrigin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "absolute", value: originMaster },
      outPoint: { txHash: originMaster.txHash, index: 0n },
    });
    const liveOrder = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "absolute", value: originMaster },
      lock: orderScript,
      outPoint: { txHash: byte32FromByte("67"), index: 0n },
    });
    const liveMaster = masterCell(originMaster, orderScript, ownerLock);
    const tx = transactionWithOutputs([fakeOrigin.cell, liveMaster]);
    const client = originLookupClient({
      liveOrder: liveOrder.cell,
      liveMaster,
      originMasterTxHash: originMaster.txHash,
      originTransaction: tx,
    });

    const { groups, skippedReasons } = await collectSkippedOrders(manager, client);

    expect(groups).toHaveLength(0);
    expect(skippedReasons).toEqual([MISSING_ORIGIN]);
  });

  it("uses cached origin transactions before fetching from the client", async () => {
    const { manager, orderScript, ownerLock } = findOrdersFixture();
    const originMaster = { txHash: byte32FromByte("69"), index: 1n };
    const { origin, liveOrder } = linkedOriginAndOrder({
      originMaster,
      orderScript,
      liveOrderByte: "70",
    });
    const liveMaster = masterCell(originMaster, orderScript, ownerLock);
    const cachedResponse = transactionResponse(
      transactionWithOutputs([origin.cell, liveMaster]),
    );
    let fetched = false;
    const client = new StubClient({
      cache: new TransactionResponseCache(originMaster.txHash, cachedResponse),
      async *findCellsOnChain(query: FindCellsOnChainQuery): FindCellsOnChainReturn {
        await Promise.resolve();
        if (query.scriptType === "lock") {
          yield liveOrder.cell;
        } else {
          yield liveMaster;
        }
      },
      getTransaction: async (): GetTransactionReturn => {
        fetched = true;
        await Promise.resolve();
        return undefined;
      },
    });

    const groups = await collectOrders(manager, client);

    expect(groups).toHaveLength(1);
    expect(fetched).toBe(false);
  });
});

class TransactionResponseCache extends ccc.ClientCacheMemory {
  private readonly txHash: ccc.Hex;
  private readonly response: ccc.ClientTransactionResponse;

  constructor(txHash: ccc.Hex, response: ccc.ClientTransactionResponse) {
    super();
    this.txHash = txHash;
    this.response = response;
  }

  public override async getTransactionResponse(
    txHash: ccc.HexLike,
  ): Promise<ccc.ClientTransactionResponse | undefined> {
    await Promise.resolve();
    return ccc.hexFrom(txHash) === this.txHash ? this.response.clone() : undefined;
  }

  public override async recordTransactionResponses(): Promise<void> {
    await Promise.resolve();
    throw new Error("Should not record cached response");
  }
}

describe(ORDER_MANAGER_FIND_ORDERS_SUITE, () => {
  it("findOrigin fails closed for multiple minted origins in the master transaction", async () => {
    const { manager, orderScript, ownerLock } = findOrdersFixture();
    const originMaster = { txHash: byte32FromByte("66"), index: 2n };
    const firstOrigin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: {
        type: "relative",
        value: Relative.create(2n),
      },
      lock: orderScript,
      outPoint: { txHash: originMaster.txHash, index: 0n },
    });
    const secondOrigin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: {
        type: "relative",
        value: Relative.create(1n),
      },
      lock: orderScript,
      outPoint: { txHash: originMaster.txHash, index: 1n },
    });
    const liveOrder = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "absolute", value: originMaster },
      lock: orderScript,
      outPoint: { txHash: byte32FromByte("68"), index: 0n },
    });
    const liveMaster = masterCell(originMaster, orderScript, ownerLock);
    const tx = transactionWithOutputs([firstOrigin.cell, secondOrigin.cell, liveMaster]);
    const client = originLookupClient({
      liveOrder: liveOrder.cell,
      liveMaster,
      originMasterTxHash: originMaster.txHash,
      originTransaction: tx,
    });

    expect(firstOrigin.getMaster().eq(originMaster)).toBe(true);
    expect(secondOrigin.getMaster().eq(originMaster)).toBe(true);
    const { groups, skippedReasons } = await collectSkippedOrders(manager, client);

    expect(groups).toHaveLength(0);
    expect(skippedReasons).toEqual(["ambiguous-origin"]);
  });
});

describe(ORDER_MANAGER_FIND_ORDERS_SUITE, () => {
  it("reports a missing origin when the master transaction cannot be loaded", async () => {
    const { manager, orderScript, ownerLock } = findOrdersFixture();
    const originMaster = { txHash: byte32FromByte("61"), index: 1n };
    const liveOrder = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "absolute", value: originMaster },
      lock: orderScript,
      outPoint: { txHash: byte32FromByte("62"), index: 0n },
    });
    const liveMaster = masterCell(originMaster, orderScript, ownerLock);
    const client = originLookupClient({
      liveOrder: liveOrder.cell,
      liveMaster,
      originMasterTxHash: byte32FromByte("ff"),
      originTransaction: ccc.Transaction.default(),
    });

    const { groups, skippedReasons } = await collectSkippedOrders(manager, client);

    expect(groups).toHaveLength(0);
    expect(skippedReasons).toEqual([MISSING_ORIGIN]);
  });

  it("reports ambiguous descendant orders separately from missing descendants", async () => {
    const { manager, orderScript, ownerLock } = findOrdersFixture();
    const originMaster = { txHash: byte32FromByte("63"), index: 1n };
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "relative", value: Relative.create(1n) },
      lock: orderScript,
      outPoint: { txHash: originMaster.txHash, index: 0n },
    });
    const firstOrder = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "absolute", value: originMaster },
      lock: orderScript,
      outPoint: { txHash: byte32FromByte("64"), index: 0n },
    });
    const secondOrder = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "absolute", value: originMaster },
      lock: orderScript,
      outPoint: { txHash: byte32FromByte("64"), index: 1n },
    });
    const liveMaster = masterCell(originMaster, orderScript, ownerLock);
    const tx = transactionWithOutputs([origin.cell, liveMaster]);
    const client = new StubClient({
      cache: new ccc.ClientCacheMemory(),
      async *findCellsOnChain(query: FindCellsOnChainQuery): FindCellsOnChainReturn {
        await Promise.resolve();
        if (query.scriptType === "lock") {
          yield firstOrder.cell;
          yield secondOrder.cell;
        } else {
          yield liveMaster;
        }
      },
      getTransaction: async (): GetTransactionReturn => {
        await Promise.resolve();
        return transactionResponse(tx);
      },
    });

    const { groups, skippedReasons } = await collectSkippedOrders(manager, client);

    expect(groups).toHaveLength(0);
    expect(skippedReasons).toEqual(["ambiguous-order"]);
  });
});

describe(ORDER_MANAGER_FIND_ORDERS_SUITE, () => {
  it("reports missing descendant orders when no scanned order validates", async () => {
    const { manager, orderScript, ownerLock } = findOrdersFixture();
    const originMaster = { txHash: byte32FromByte("6c"), index: 1n };
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "relative", value: Relative.create(1n) },
      lock: orderScript,
      outPoint: { txHash: originMaster.txHash, index: 0n },
    });
    const liveOrder = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 2n, udtScale: 1n }, 0),
      master: { type: "absolute", value: originMaster },
      lock: orderScript,
      outPoint: { txHash: byte32FromByte("6d"), index: 0n },
    });
    const liveMaster = masterCell(originMaster, orderScript, ownerLock);
    const client = originLookupClient({
      liveOrder: liveOrder.cell,
      liveMaster,
      originMasterTxHash: originMaster.txHash,
      originTransaction: transactionWithOutputs([origin.cell, liveMaster]),
    });

    const { groups, skippedReasons } = await collectSkippedOrders(manager, client);

    expect(groups).toHaveLength(0);
    expect(skippedReasons).toEqual(["missing-order"]);
  });
});

function linkedOriginAndOrder(options: {
  originMaster: { txHash: `0x${string}`; index: bigint };
  orderScript: ccc.Script;
  liveOrderByte: string;
}): {
  origin: ReturnType<typeof makeOrderCell>;
  liveOrder: ReturnType<typeof makeOrderCell>;
} {
  const origin = makeOrderCell({
    ckbUnoccupied: ccc.fixedPointFrom(100),
    udtValue: 0n,
    info: directionalInfo(),
    master: { type: "relative", value: Relative.create(1n) },
    lock: options.orderScript,
    outPoint: { txHash: options.originMaster.txHash, index: 0n },
  });
  const liveOrder = makeOrderCell({
    ckbUnoccupied: ccc.fixedPointFrom(100),
    udtValue: 0n,
    info: directionalInfo(),
    master: { type: "absolute", value: options.originMaster },
    lock: options.orderScript,
    outPoint: { txHash: byte32FromByte(options.liveOrderByte), index: 0n },
  });
  return { origin, liveOrder };
}
