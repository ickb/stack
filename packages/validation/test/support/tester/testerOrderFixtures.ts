import { ccc } from "@ckb-ccc/core";
import {
  type IckbSdk,
  MasterCell,
  OrderCell,
  OrderData,
  type OrderGroup,
  OrderManager,
  Ratio,
} from "@ickb/sdk";

import {
  byte32FromByte,
  committedTransactionResponse,
  script,
  StubClient,
} from "@ickb/testkit";
import type { EstimatedOrder } from "./testerFreshFixtures.ts";

export function orderInfoForEstimate(): ReturnType<typeof IckbSdk.estimate>["info"] {
  return OrderData.from({
    udtValue: 0n,
    master: {
      type: "relative",
      value: { distance: 1n, padding: new Uint8Array(32) },
    },
    info: {
      ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      udtToCkb: Ratio.empty(),
      ckbMinMatchLog: 0,
    },
  }).info;
}
export async function matchableOrder(txHash: ccc.Hex): Promise<OrderGroup> {
  const group = await order(txHash, true, {
    type: "relative",
    value: { distance: 1n, padding: new Uint8Array(32) },
  });
  assertOrderTxHash(group, txHash);
  return group;
}
export async function matchedDescendantOrder(
  txHash: ccc.Hex,
  masterTxHash: ccc.Hex,
): Promise<OrderGroup> {
  const group = await order(txHash, true, {
    type: "absolute",
    value: { txHash: masterTxHash, index: 1n },
  });
  assertOrderTxHash(group, txHash);
  return group;
}
export async function nonMatchableOrder(txHash: ccc.Hex): Promise<OrderGroup> {
  const group = await order(txHash, false, {
    type: "relative",
    value: { distance: 1n, padding: new Uint8Array(32) },
  });
  assertOrderTxHash(group, txHash);
  return group;
}
export async function unmarketableOrder(txHash: ccc.Hex): Promise<OrderGroup> {
  const group = await order(
    txHash,
    true,
    { type: "relative", value: { distance: 1n, padding: new Uint8Array(32) } },
    Ratio.from({ ckbScale: 2000n, udtScale: 1n }),
    Ratio.empty(),
    0n,
    1n,
  );
  assertOrderTxHash(group, txHash);
  return group;
}
export async function udtToCkbOrder(txHash: ccc.Hex): Promise<OrderGroup> {
  const group = await order(
    txHash,
    true,
    { type: "relative", value: { distance: 1n, padding: new Uint8Array(32) } },
    Ratio.empty(),
    Ratio.from({
      ckbScale: 20_000_000_000_000_000n,
      udtScale: 8_200_000_001_000n,
    }),
    ccc.fixedPointFrom(100),
  );
  assertOrderTxHash(group, txHash);
  return group;
}
type OrderFixtureParameters = [
  txHash: ccc.Hex,
  isMatchable: boolean,
  master: Parameters<typeof OrderData.from>[0]["master"],
  ckbToUdt?: Ratio,
  udtToCkb?: Ratio,
  udtValue?: bigint,
  ckbValue?: bigint,
];
async function order(
  ...[
    txHash,
    isMatchable,
    masterRef,
    ckbToUdt = Ratio.from({ ckbScale: 1n, udtScale: 2n }),
    udtToCkb = Ratio.empty(),
    udtValue = 0n,
    ckbValue = isMatchable ? ccc.fixedPointFrom(100) : 0n,
  ]: OrderFixtureParameters
): Promise<OrderGroup> {
  const udtScript = script("66");
  const orderLock = script("55");
  const masterOutPoint =
    masterRef.type === "relative"
      ? { txHash, index: masterRef.value.distance }
      : ccc.OutPoint.from(masterRef.value);
  const master = MasterCell.from({
    outPoint: masterOutPoint,
    cellOutput: { lock: orderLock, type: orderLock },
    outputData: "0x",
  });
  const originData = OrderData.from({
    udtValue,
    master: {
      type: "relative",
      value: { distance: 1n, padding: new Uint8Array(32) },
    },
    info: { ckbToUdt, udtToCkb, ckbMinMatchLog: 0 },
  }).toBytes();
  const outputData = OrderData.from({
    udtValue,
    master: masterRef,
    info: { ckbToUdt, udtToCkb, ckbMinMatchLog: 0 },
  }).toBytes();
  const origin = fixtureOrderCell({
    txHash: masterOutPoint.txHash,
    outputData: originData,
    ckbValue,
    orderLock,
    udtScript,
  });
  const orderCell = fixtureOrderCell({
    txHash,
    outputData,
    ckbValue,
    orderLock,
    udtScript,
  });
  const transaction = ccc.Transaction.default();
  transaction.outputs.push(origin.cell.cellOutput, master.cell.cellOutput);
  transaction.outputsData.push(origin.cell.outputData, master.cell.outputData);
  const manager = new OrderManager(orderLock, [], udtScript);
  const client = new StubClient({
    cache: new ccc.ClientCacheMemory(),
    async *findCellsOnChain(query): ReturnType<ccc.Client["findCellsOnChain"]> {
      await Promise.resolve();
      if (query.scriptType === "lock") {
        yield orderCell.cell;
      } else {
        yield master.cell;
      }
    },
    getTransaction: async (requestedTxHash): ReturnType<ccc.Client["getTransaction"]> => {
      await Promise.resolve();
      return requestedTxHash === masterOutPoint.txHash
        ? committedTransactionResponse(transaction)
        : undefined;
    },
  });
  return singleResolvedOrder(manager, client);
}

async function singleResolvedOrder(
  manager: OrderManager,
  client: ccc.Client,
): Promise<OrderGroup> {
  const groups: OrderGroup[] = [];
  for await (const group of manager.findOrders(client)) {
    groups.push(group);
  }
  const group = groups[0];
  if (group === undefined || groups.length !== 1) {
    throw new Error("Expected one resolver-produced order fixture");
  }
  return group;
}

function assertOrderTxHash(group: OrderGroup, txHash: ccc.Hex): void {
  if (group.order.cell.outPoint.txHash !== txHash) {
    throw new Error("Resolver-produced order fixture has unexpected transaction hash");
  }
}

function fixtureOrderCell({
  txHash,
  outputData,
  ckbValue,
  orderLock,
  udtScript,
}: {
  txHash: ccc.Hex;
  outputData: ccc.BytesLike;
  ckbValue: bigint;
  orderLock: ccc.Script;
  udtScript: ccc.Script;
}): OrderCell {
  const minimalCell = ccc.Cell.from({
    outPoint: { txHash, index: 0n },
    cellOutput: { lock: orderLock, type: udtScript },
    outputData,
  });
  return OrderCell.mustFrom(
    ccc.Cell.from({
      outPoint: { txHash, index: 0n },
      cellOutput: {
        capacity: minimalCell.cellOutput.capacity + ckbValue,
        lock: orderLock,
        type: udtScript,
      },
      outputData,
    }),
  );
}
export type EstimatedOrderFixtureParameters = [
  direction: "ckb-to-ickb" | "ickb-to-ckb",
  amount: bigint,
  ckbValue: bigint,
  udtValue: bigint,
  ckbFee: bigint,
];
export function estimatedOrder(
  ...[direction, amount, ckbValue, udtValue, ckbFee]: EstimatedOrderFixtureParameters
): EstimatedOrder {
  return {
    direction,
    amount,
    amounts: { ckbValue, udtValue },
    estimate: {
      convertedAmount: direction === "ckb-to-ickb" ? udtValue : ckbValue,
      ckbFee,
      info: orderInfoForEstimate(),
      maturity: 0n,
    },
  };
}
export async function mintedOrder(
  info: ReturnType<typeof IckbSdk.estimate>["info"],
  amounts: { ckbValue: bigint; udtValue: bigint },
): Promise<OrderGroup> {
  const txHash = byte32FromByte("aa");
  const group = await order(
    txHash,
    true,
    { type: "relative", value: { distance: 1n, padding: new Uint8Array(32) } },
    info.ckbToUdt,
    info.udtToCkb,
    amounts.udtValue,
    amounts.ckbValue,
  );
  assertOrderTxHash(group, txHash);
  return group;
}
