import { ccc } from "@ckb-ccc/core";
import { defaultFindCellsLimit } from "@ickb/utils";
import { describe, expect, it } from "vitest";
import { OrderCell } from "./cells.js";
import { Info, OrderData, Ratio, Relative } from "./entities.js";
import { OrderManager, OrderMatcher } from "./order.js";

describe("Ratio", () => {
  it("compares ratios exactly beyond Number precision", () => {
    const scale = 2n ** 60n;
    const larger = Ratio.from({ ckbScale: scale + 1n, udtScale: scale });
    const smaller = Ratio.from({ ckbScale: scale, udtScale: scale });

    expect(Number((scale + 1n) * scale - scale * scale)).toBe(
      Number(scale),
    );
    expect(larger.compare(smaller)).toBe(1);
    expect(smaller.compare(larger)).toBe(-1);
  });
});

describe("OrderMatcher", () => {
  it("sorts effective ratios exactly beyond Number precision", () => {
    const order = makeUdtToCkbOrder();
    const scale = 2n ** 60n;
    const better = new OrderMatcher(
      order,
      true,
      1n,
      1n,
      0n,
      0n,
      0n,
      0n,
      0n,
      0n,
      scale + 1n,
      scale,
    );
    const worse = new OrderMatcher(
      order,
      true,
      1n,
      1n,
      0n,
      0n,
      0n,
      0n,
      0n,
      0n,
      scale,
      scale,
    );

    expect(Number(scale + 1n) / Number(scale)).toBe(1);
    expect(OrderMatcher.compareRealRatioDesc(better, worse)).toBeLessThan(0);
    expect(OrderMatcher.compareRealRatioDesc(worse, better)).toBeGreaterThan(0);
  });

  it("reports UDT-to-CKB fee in CKB units", () => {
    const result = OrderManager.convert(
      false,
      Ratio.from({ ckbScale: 2n, udtScale: 1n }),
      { ckbValue: 0n, udtValue: 100n },
      { fee: 1n, feeBase: 10n },
    );

    expect(result.convertedAmount).toBe(45n);
    expect(result.ckbFee).toBe(5n);
  });

  it("uses udtToCkb scales for UDT-to-CKB orders", () => {
    const order = makeUdtToCkbOrder();

    const matcher = OrderMatcher.from(order, false, 0n);

    expect(matcher).toBeDefined();
    expect(OrderMatcher.from(order, true, 0n)).toBeUndefined();
    expect(matcher?.aScale).toBe(2n);
    expect(matcher?.bScale).toBe(5n);
    expect(matcher?.bMaxMatch).toBeGreaterThan(0n);
  });

  it("lets bestMatch consume UDT-to-CKB orders", () => {
    const order = makeUdtToCkbOrder();

    const match = OrderManager.bestMatch(
      [order],
      {
        ckbValue: ccc.fixedPointFrom(200),
        udtValue: 0n,
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );

    expect(match.partials).toHaveLength(1);
    expect(match.ckbDelta).toBeLessThan(0n);
    expect(match.udtDelta).toBeGreaterThan(0n);
  });

  it("respects a partial cap when selecting the best match", () => {
    const orders = [
      makeUdtToCkbOrder({
        txHashByte: "10",
        orderTxHashByte: "20",
      }),
      makeUdtToCkbOrder({
        txHashByte: "11",
        orderTxHashByte: "21",
      }),
    ];

    const uncapped = OrderManager.bestMatch(
      orders,
      {
        ckbValue: ccc.fixedPointFrom(1000),
        udtValue: 0n,
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );
    const capped = OrderManager.bestMatch(
      orders,
      {
        ckbValue: ccc.fixedPointFrom(1000),
        udtValue: 0n,
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
        maxPartials: 1,
      },
    );

    expect(uncapped.partials).toHaveLength(2);
    expect(capped.partials).toHaveLength(1);
    expect(capped.ckbDelta).toBeLessThan(0n);
    expect(capped.udtDelta).toBeGreaterThan(0n);
  });

  it("charges one mining fee unit per selected partial", () => {
    const order = makeUdtToCkbOrder();

    const match = OrderManager.bestMatch(
      [order],
      {
        ckbValue: ccc.fixedPointFrom(60),
        udtValue: 0n,
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: 1000n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );

    expect(match.partials).toHaveLength(1);
    expect(match.ckbDelta).toBe(-ccc.fixedPointFrom(40));
  });

  it("ignores matches whose estimated mining fee exceeds the value gain", () => {
    const order = makeUdtToCkbOrder();

    const match = OrderManager.bestMatch(
      [order],
      {
        ckbValue: ccc.fixedPointFrom(1000),
        udtValue: 0n,
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: ccc.fixedPointFrom(1000),
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );

    expect(match).toEqual({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
    });
  });

  it("rejects UDT-to-CKB partials below the converted CKB minimum", () => {
    const order = makeUdtToCkbOrder();
    const matcher = OrderMatcher.from(order, false, 0n);

    const belowMinimum = matcher?.match(1n);
    const atMinimum = matcher?.match(3n);

    expect(belowMinimum?.partials).toHaveLength(0);
    expect(atMinimum?.partials).toHaveLength(1);
    expect(atMinimum?.partials[0]?.ckbOut).toBe(ccc.fixedPointFrom(200) + 3n);
    expect(atMinimum?.partials[0]?.udtOut).toBe(ccc.fixedPointFrom(100) - 7n);
  });
});

describe("OrderCell.resolve", () => {
  it("prefers directional progress over a higher-value unprogressed candidate", () => {
    const master = {
      txHash: byte32FromByte("55"),
      index: 10n,
    };
    const info = directionalInfo();
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("44"), index: 0n },
    });
    const progressed = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(50),
      udtValue: ccc.fixedPointFrom(50),
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("66"), index: 0n },
    });
    const forged = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(200),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("77"), index: 0n },
    });

    expect(progressed.absProgress).toBeGreaterThan(forged.absProgress);
    expect(forged.absTotal).toBeGreaterThan(progressed.absTotal);
    expect(origin.resolve([forged, progressed])).toBe(progressed);
  });

  it("uses best value for dual-sided orders via absProgress === absTotal", () => {
    const master = {
      txHash: byte32FromByte("88"),
      index: 10n,
    };
    const info = dualInfo();
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("44"), index: 0n },
    });
    const lowerValue = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("99"), index: 0n },
    });
    const higherValue = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(60),
      udtValue: ccc.fixedPointFrom(60),
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("aa"), index: 0n },
    });

    expect(lowerValue.absProgress).toBe(lowerValue.absTotal);
    expect(higherValue.absProgress).toBe(higherValue.absTotal);
    expect(higherValue.absTotal).toBeGreaterThan(lowerValue.absTotal);
    expect(origin.resolve([lowerValue, higherValue])).toBe(higherValue);
  });

  it("fails closed for ambiguous equal-progress non-mint candidates", () => {
    const master = {
      txHash: byte32FromByte("bb"),
      index: 10n,
    };
    const info = directionalInfo();
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("44"), index: 0n },
    });
    const nonMint = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("cc"), index: 0n },
    });
    const otherNonMint = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: {
        type: "absolute",
        value: {
          txHash: master.txHash,
          index: master.index,
        },
      },
      outPoint: { txHash: byte32FromByte("dd"), index: 0n },
    });

    expect(origin.resolve([nonMint, otherNonMint])).toBeUndefined();
    expect(origin.resolve([otherNonMint, nonMint])).toBeUndefined();
  });

  it("prefers a mint candidate over an equal-progress non-mint candidate", () => {
    const master = {
      txHash: byte32FromByte("bc"),
      index: 10n,
    };
    const info = directionalInfo();
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("44"), index: 0n },
    });
    const nonMint = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("ce"), index: 0n },
    });
    const mint = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: {
        type: "relative",
        value: Relative.create(1n),
      },
      outPoint: { txHash: master.txHash, index: 9n },
    });

    expect(mint.getMaster().eq(origin.getMaster())).toBe(true);
    expect(origin.resolve([nonMint, mint])).toBe(mint);
    expect(origin.resolve([mint, nonMint])).toBe(mint);
  });

  it("does not treat duplicate same-outpoint candidates as ambiguous", () => {
    const master = {
      txHash: byte32FromByte("bd"),
      index: 10n,
    };
    const info = directionalInfo();
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("44"), index: 0n },
    });
    const duplicate = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("cf"), index: 0n },
    });

    expect(origin.resolve([duplicate, duplicate])).toBe(duplicate);
  });
});

describe("OrderManager.findOrders", () => {
  it("fails closed when order scanning reaches the limit", async () => {
    const orderScript = ccc.Script.from({
      codeHash: byte32FromByte("11"),
      hashType: "type",
      args: "0x",
    });
    const udtScript = ccc.Script.from({
      codeHash: byte32FromByte("22"),
      hashType: "type",
      args: "0x",
    });
    const manager = new OrderManager(orderScript, [], udtScript);
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte("33"), index: 1n },
      },
      lock: orderScript,
      outPoint: { txHash: byte32FromByte("34"), index: 0n },
    });
    const client = {
      findCellsOnChain: async function* (query: { scriptType: string }) {
        await Promise.resolve();
        if (query.scriptType !== "lock") {
          return;
        }

        for (let index = 0; index < defaultFindCellsLimit; index += 1) {
          yield order.cell;
        }
      },
    } as unknown as ccc.Client;

    await expect(collectOrders(manager, client)).rejects.toThrow(
      `order cell scan reached limit ${String(defaultFindCellsLimit)}`,
    );
  });

  it("fails closed when master scanning reaches the limit", async () => {
    const orderScript = ccc.Script.from({
      codeHash: byte32FromByte("11"),
      hashType: "type",
      args: "0x",
    });
    const udtScript = ccc.Script.from({
      codeHash: byte32FromByte("22"),
      hashType: "type",
      args: "0x",
    });
    const ownerLock = ccc.Script.from({
      codeHash: byte32FromByte("44"),
      hashType: "type",
      args: "0x",
    });
    const manager = new OrderManager(orderScript, [], udtScript);
    const masterCell = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("35"), index: 1n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(61),
        lock: ownerLock,
        type: orderScript,
      },
      outputData: "0x",
    });
    const client = {
      findCellsOnChain: async function* (query: { scriptType: string }) {
        await Promise.resolve();
        if (query.scriptType !== "type") {
          return;
        }

        for (let index = 0; index < defaultFindCellsLimit; index += 1) {
          yield masterCell;
        }
      },
    } as unknown as ccc.Client;

    await expect(collectOrders(manager, client)).rejects.toThrow(
      `master cell scan reached limit ${String(defaultFindCellsLimit)}`,
    );
  });

  it("findOrigin skips parseable non-mint origins in the master transaction", async () => {
    const orderScript = ccc.Script.from({
      codeHash: byte32FromByte("11"),
      hashType: "type",
      args: "0x",
    });
    const udtScript = ccc.Script.from({
      codeHash: byte32FromByte("22"),
      hashType: "type",
      args: "0x",
    });
    const manager = new OrderManager(orderScript, [], udtScript);
    const originMaster = { txHash: byte32FromByte("55"), index: 2n };
    const ownerLock = ccc.Script.from({
      codeHash: byte32FromByte("44"),
      hashType: "type",
      args: "0x",
    });
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
    const masterCell = ccc.Cell.from({
      outPoint: originMaster,
      cellOutput: {
        capacity: ccc.fixedPointFrom(61),
        lock: ownerLock,
        type: orderScript,
      },
      outputData: "0x",
    });
    const tx = ccc.Transaction.default();
    tx.outputs.push(trueOrigin.cell.cellOutput, forgedOrigin.cell.cellOutput, masterCell.cellOutput);
    tx.outputsData.push(trueOrigin.cell.outputData, forgedOrigin.cell.outputData, masterCell.outputData);
    const client = {
      findCellsOnChain: async function* (query: { scriptType: string }) {
        await Promise.resolve();
        if (query.scriptType === "lock") {
          yield liveOrder.cell;
        } else {
          yield masterCell;
        }
      },
      getTransaction: async (txHash: ccc.Hex) => {
        await Promise.resolve();
        return txHash === originMaster.txHash
          ? ccc.ClientTransactionResponse.from({
              transaction: tx,
              status: "committed",
            })
          : undefined;
      },
    } as unknown as ccc.Client;

    expect(trueOrigin.data.master.type).toBe("relative");
    if (trueOrigin.data.master.type !== "relative") {
      throw new Error("Expected relative master");
    }
    expect(trueOrigin.data.master.value.distance).toBe(2n);
    expect(trueOrigin.getMaster().eq(originMaster)).toBe(true);
    const groups = [];
    for await (const group of manager.findOrders(client)) {
      groups.push(group);
    }

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

  it("findOrigin requires a minted origin in the master transaction", async () => {
    const orderScript = ccc.Script.from({
      codeHash: byte32FromByte("11"),
      hashType: "type",
      args: "0x",
    });
    const udtScript = ccc.Script.from({
      codeHash: byte32FromByte("22"),
      hashType: "type",
      args: "0x",
    });
    const manager = new OrderManager(orderScript, [], udtScript);
    const originMaster = { txHash: byte32FromByte("65"), index: 1n };
    const ownerLock = ccc.Script.from({
      codeHash: byte32FromByte("44"),
      hashType: "type",
      args: "0x",
    });
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
    const masterCell = ccc.Cell.from({
      outPoint: originMaster,
      cellOutput: {
        capacity: ccc.fixedPointFrom(61),
        lock: ownerLock,
        type: orderScript,
      },
      outputData: "0x",
    });
    const tx = ccc.Transaction.default();
    tx.outputs.push(fakeOrigin.cell.cellOutput, masterCell.cellOutput);
    tx.outputsData.push(fakeOrigin.cell.outputData, masterCell.outputData);
    const client = {
      findCellsOnChain: async function* (query: { scriptType: string }) {
        await Promise.resolve();
        if (query.scriptType === "lock") {
          yield liveOrder.cell;
        } else {
          yield masterCell;
        }
      },
      getTransaction: async (txHash: ccc.Hex) => {
        await Promise.resolve();
        return txHash === originMaster.txHash
          ? ccc.ClientTransactionResponse.from({
              transaction: tx,
              status: "committed",
            })
          : undefined;
      },
    } as unknown as ccc.Client;

    const groups = [];
    for await (const group of manager.findOrders(client)) {
      groups.push(group);
    }

    expect(groups).toHaveLength(0);
  });

  it("findOrigin fails closed for multiple minted origins in the master transaction", async () => {
    const orderScript = ccc.Script.from({
      codeHash: byte32FromByte("11"),
      hashType: "type",
      args: "0x",
    });
    const udtScript = ccc.Script.from({
      codeHash: byte32FromByte("22"),
      hashType: "type",
      args: "0x",
    });
    const manager = new OrderManager(orderScript, [], udtScript);
    const originMaster = { txHash: byte32FromByte("66"), index: 2n };
    const ownerLock = ccc.Script.from({
      codeHash: byte32FromByte("44"),
      hashType: "type",
      args: "0x",
    });
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
    const masterCell = ccc.Cell.from({
      outPoint: originMaster,
      cellOutput: {
        capacity: ccc.fixedPointFrom(61),
        lock: ownerLock,
        type: orderScript,
      },
      outputData: "0x",
    });
    const tx = ccc.Transaction.default();
    tx.outputs.push(firstOrigin.cell.cellOutput, secondOrigin.cell.cellOutput, masterCell.cellOutput);
    tx.outputsData.push(firstOrigin.cell.outputData, secondOrigin.cell.outputData, masterCell.outputData);
    const client = {
      findCellsOnChain: async function* (query: { scriptType: string }) {
        await Promise.resolve();
        if (query.scriptType === "lock") {
          yield liveOrder.cell;
        } else {
          yield masterCell;
        }
      },
      getTransaction: async (txHash: ccc.Hex) => {
        await Promise.resolve();
        return txHash === originMaster.txHash
          ? ccc.ClientTransactionResponse.from({
              transaction: tx,
              status: "committed",
            })
          : undefined;
      },
    } as unknown as ccc.Client;

    expect(firstOrigin.getMaster().eq(originMaster)).toBe(true);
    expect(secondOrigin.getMaster().eq(originMaster)).toBe(true);
    const groups = [];
    for await (const group of manager.findOrders(client)) {
      groups.push(group);
    }

    expect(groups).toHaveLength(0);
  });

  it("uses live queries by default", async () => {
    const orderScript = ccc.Script.from({
      codeHash: byte32FromByte("11"),
      hashType: "type",
      args: "0x",
    });
    const udtScript = ccc.Script.from({
      codeHash: byte32FromByte("22"),
      hashType: "type",
      args: "0x",
    });
    const ownerLock = ccc.Script.from({
      codeHash: byte32FromByte("44"),
      hashType: "type",
      args: "0x",
    });
    const manager = new OrderManager(orderScript, [], udtScript);
    const originMaster = { txHash: byte32FromByte("77"), index: 1n };
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: {
        type: "relative",
        value: Relative.create(1n),
      },
      lock: orderScript,
      outPoint: { txHash: originMaster.txHash, index: 0n },
    });
    const masterCell = ccc.Cell.from({
      outPoint: originMaster,
      cellOutput: {
        capacity: ccc.fixedPointFrom(61),
        lock: ownerLock,
        type: orderScript,
      },
      outputData: "0x",
    });
    let cachedCalls = 0;
    let onChainCalls = 0;
    const tx = ccc.Transaction.default();
    tx.outputs.push(origin.cell.cellOutput, masterCell.cellOutput);
    tx.outputsData.push(origin.cell.outputData, masterCell.outputData);
    const client = {
      findCells: async function* () {
        await Promise.resolve();
        cachedCalls += 1;
        yield* [] as ccc.Cell[];
      },
      findCellsOnChain: async function* (query: { scriptType: string }) {
        await Promise.resolve();
        onChainCalls += 1;
        if (query.scriptType === "lock") {
          yield origin.cell;
        } else {
          yield masterCell;
        }
      },
      getTransaction: async (txHash: ccc.Hex) => {
        await Promise.resolve();
        return txHash === originMaster.txHash
          ? ccc.ClientTransactionResponse.from({
              transaction: tx,
              status: "committed",
            })
          : undefined;
      },
    } as unknown as ccc.Client;

    const groups = [];
    for await (const group of manager.findOrders(client)) {
      groups.push(group);
    }

    expect(groups).toHaveLength(1);
    expect(cachedCalls).toBe(0);
    expect(onChainCalls).toBe(2);
  });

  it("uses cached queries when onChain is false", async () => {
    const orderScript = ccc.Script.from({
      codeHash: byte32FromByte("11"),
      hashType: "type",
      args: "0x",
    });
    const udtScript = ccc.Script.from({
      codeHash: byte32FromByte("22"),
      hashType: "type",
      args: "0x",
    });
    const ownerLock = ccc.Script.from({
      codeHash: byte32FromByte("44"),
      hashType: "type",
      args: "0x",
    });
    const manager = new OrderManager(orderScript, [], udtScript);
    const originMaster = { txHash: byte32FromByte("77"), index: 1n };
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: {
        type: "relative",
        value: Relative.create(1n),
      },
      lock: orderScript,
      outPoint: { txHash: originMaster.txHash, index: 0n },
    });
    const masterCell = ccc.Cell.from({
      outPoint: originMaster,
      cellOutput: {
        capacity: ccc.fixedPointFrom(61),
        lock: ownerLock,
        type: orderScript,
      },
      outputData: "0x",
    });
    let cachedCalls = 0;
    let onChainCalls = 0;
    const tx = ccc.Transaction.default();
    tx.outputs.push(origin.cell.cellOutput, masterCell.cellOutput);
    tx.outputsData.push(origin.cell.outputData, masterCell.outputData);
    const client = {
      findCells: async function* (query: { scriptType: string }) {
        await Promise.resolve();
        cachedCalls += 1;
        if (query.scriptType === "lock") {
          yield origin.cell;
        } else {
          yield masterCell;
        }
      },
      findCellsOnChain: async function* () {
        await Promise.resolve();
        onChainCalls += 1;
        yield* [] as ccc.Cell[];
      },
      getTransaction: async (txHash: ccc.Hex) => {
        await Promise.resolve();
        return txHash === originMaster.txHash
          ? ccc.ClientTransactionResponse.from({
              transaction: tx,
              status: "committed",
            })
          : undefined;
      },
    } as unknown as ccc.Client;

    const groups = [];
    for await (const group of manager.findOrders(client, { onChain: false })) {
      groups.push(group);
    }

    expect(groups).toHaveLength(1);
    expect(cachedCalls).toBe(2);
    expect(onChainCalls).toBe(0);
  });

  it("skips groups with ambiguous same-score descendants", async () => {
    const orderScript = ccc.Script.from({
      codeHash: byte32FromByte("11"),
      hashType: "type",
      args: "0x",
    });
    const udtScript = ccc.Script.from({
      codeHash: byte32FromByte("22"),
      hashType: "type",
      args: "0x",
    });
    const ownerLock = ccc.Script.from({
      codeHash: byte32FromByte("44"),
      hashType: "type",
      args: "0x",
    });
    const manager = new OrderManager(orderScript, [], udtScript);
    const originMaster = { txHash: byte32FromByte("87"), index: 1n };
    const info = directionalInfo();
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: {
        type: "relative",
        value: Relative.create(1n),
      },
      lock: orderScript,
      outPoint: { txHash: originMaster.txHash, index: 0n },
    });
    const liveOrder = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: originMaster },
      lock: orderScript,
      outPoint: { txHash: byte32FromByte("97"), index: 0n },
    });
    const forgedOrder = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: originMaster },
      lock: orderScript,
      outPoint: { txHash: byte32FromByte("98"), index: 0n },
    });
    const masterCell = ccc.Cell.from({
      outPoint: originMaster,
      cellOutput: {
        capacity: ccc.fixedPointFrom(61),
        lock: ownerLock,
        type: orderScript,
      },
      outputData: "0x",
    });
    const tx = ccc.Transaction.default();
    tx.outputs.push(origin.cell.cellOutput, masterCell.cellOutput);
    tx.outputsData.push(origin.cell.outputData, masterCell.outputData);
    const client = {
      findCellsOnChain: async function* (query: { scriptType: string }) {
        await Promise.resolve();
        if (query.scriptType === "lock") {
          yield liveOrder.cell;
          yield forgedOrder.cell;
        } else {
          yield masterCell;
        }
      },
      getTransaction: async (txHash: ccc.Hex) => {
        await Promise.resolve();
        return txHash === originMaster.txHash
          ? ccc.ClientTransactionResponse.from({
              transaction: tx,
              status: "committed",
            })
          : undefined;
      },
    } as unknown as ccc.Client;

    const groups = [];
    for await (const group of manager.findOrders(client)) {
      groups.push(group);
    }

    expect(groups).toHaveLength(0);
  });

  it("uses live queries when onChain is requested", async () => {
    const orderScript = ccc.Script.from({
      codeHash: byte32FromByte("11"),
      hashType: "type",
      args: "0x",
    });
    const udtScript = ccc.Script.from({
      codeHash: byte32FromByte("22"),
      hashType: "type",
      args: "0x",
    });
    const ownerLock = ccc.Script.from({
      codeHash: byte32FromByte("44"),
      hashType: "type",
      args: "0x",
    });
    const manager = new OrderManager(orderScript, [], udtScript);
    const originMaster = { txHash: byte32FromByte("88"), index: 1n };
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: {
        type: "relative",
        value: Relative.create(1n),
      },
      lock: orderScript,
      outPoint: { txHash: originMaster.txHash, index: 0n },
    });
    const masterCell = ccc.Cell.from({
      outPoint: originMaster,
      cellOutput: {
        capacity: ccc.fixedPointFrom(61),
        lock: ownerLock,
        type: orderScript,
      },
      outputData: "0x",
    });
    let cachedCalls = 0;
    let onChainCalls = 0;
    const tx = ccc.Transaction.default();
    tx.outputs.push(origin.cell.cellOutput, masterCell.cellOutput);
    tx.outputsData.push(origin.cell.outputData, masterCell.outputData);
    const client = {
      findCells: async function* () {
        await Promise.resolve();
        cachedCalls += 1;
        yield* [] as ccc.Cell[];
      },
      findCellsOnChain: async function* (query: { scriptType: string }) {
        await Promise.resolve();
        onChainCalls += 1;
        if (query.scriptType === "lock") {
          yield origin.cell;
        } else {
          yield masterCell;
        }
      },
      getTransaction: async (txHash: ccc.Hex) => {
        await Promise.resolve();
        return txHash === originMaster.txHash
          ? ccc.ClientTransactionResponse.from({
              transaction: tx,
              status: "committed",
            })
          : undefined;
      },
    } as unknown as ccc.Client;

    const groups = [];
    for await (const group of manager.findOrders(client, { onChain: true })) {
      groups.push(group);
    }

    expect(groups).toHaveLength(1);
    expect(cachedCalls).toBe(0);
    expect(onChainCalls).toBe(2);
  });
});

function makeUdtToCkbOrder(options?: {
  txHashByte?: string;
  orderTxHashByte?: string;
  udtValue?: ccc.FixedPoint;
}): OrderCell {
  const orderScript = ccc.Script.from({
    codeHash: byte32FromByte("11"),
    hashType: "type",
    args: "0x",
  });
  const udtScript = ccc.Script.from({
    codeHash: byte32FromByte("22"),
    hashType: "type",
    args: "0x",
  });

  return OrderCell.mustFrom(
    ccc.Cell.from({
      outPoint: {
        txHash: byte32FromByte(options?.orderTxHashByte ?? "44"),
        index: 0n,
      },
      cellOutput: {
        capacity: ccc.fixedPointFrom(200),
        lock: orderScript,
        type: udtScript,
      },
      outputData: OrderData.from({
        udtValue: options?.udtValue ?? ccc.fixedPointFrom(100),
        master: {
          type: "absolute",
          value: {
            txHash: byte32FromByte(options?.txHashByte ?? "33"),
            index: 1n,
          },
        },
        info: Info.from({
          ckbToUdt: Ratio.empty(),
          udtToCkb: Ratio.from({
            ckbScale: 5n,
            udtScale: 2n,
          }),
          ckbMinMatchLog: 0,
        }),
      }).toBytes(),
    }),
  );
}

function directionalInfo(): Info {
  return Info.from({
    ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    udtToCkb: Ratio.empty(),
    ckbMinMatchLog: 0,
  });
}

function dualInfo(): Info {
  const ratio = Ratio.from({ ckbScale: 1n, udtScale: 1n });
  return Info.from({
    ckbToUdt: ratio,
    udtToCkb: ratio,
    ckbMinMatchLog: 0,
  });
}

async function collectOrders(
  manager: OrderManager,
  client: ccc.Client,
): Promise<unknown[]> {
  const groups = [];
  for await (const group of manager.findOrders(client)) {
    groups.push(group);
  }
  return groups;
}

function makeOrderCell(options: {
  ckbUnoccupied: ccc.FixedPoint;
  udtValue: ccc.FixedPoint;
  info: Info;
  lock?: ccc.Script;
  master: {
    type: "relative";
    value: {
      padding: Uint8Array;
      distance: bigint;
    };
  } | {
    type: "absolute";
    value: {
      txHash: `0x${string}`;
      index: bigint;
    };
  };
  outPoint: {
    txHash: `0x${string}`;
    index: bigint;
  };
}): OrderCell {
  const orderScript = ccc.Script.from({
    codeHash: byte32FromByte("11"),
    hashType: "type",
    args: "0x",
  });
  const udtScript = ccc.Script.from({
    codeHash: byte32FromByte("22"),
    hashType: "type",
    args: "0x",
  });
  const lock = options.lock ?? orderScript;
  const outputData = OrderData.from({
    udtValue: options.udtValue,
    master: options.master,
    info: options.info,
  }).toBytes();
  const minimalCell = ccc.Cell.from({
    previousOutput: {
      txHash: byte32FromByte("ff"),
      index: 0n,
    },
    cellOutput: {
      lock,
      type: udtScript,
    },
    outputData,
  });

  return OrderCell.mustFrom(
    ccc.Cell.from({
      outPoint: options.outPoint,
      cellOutput: {
        capacity: minimalCell.cellOutput.capacity + options.ckbUnoccupied,
        lock,
        type: udtScript,
      },
      outputData,
    }),
  );
}

function byte32FromByte(hexByte: string): `0x${string}` {
  if (!/^[0-9a-f]{2}$/iu.test(hexByte)) {
    throw new Error("Expected exactly one byte as two hex chars");
  }
  return `0x${hexByte.repeat(32)}`;
}
