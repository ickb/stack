import { ccc } from "@ckb-ccc/core";
import {
  committedTransactionResponse,
  FRESH_BLOCK,
  script,
  StubClient,
  type StubCell,
} from "@ickb/testkit";
import { ICKB_UDT, ORDER } from "../../../../src/constants.ts";
import { MasterCell, OrderCell, OrderGroup } from "../../../../src/order/cells.ts";
import { Info } from "../../../../src/order/info.ts";
import { findOrders } from "../../../../src/order/order.ts";
import { OrderData } from "../../../../src/order/order_data.ts";
import { hash, ratio } from "../../../transaction/base/support/sdk_core_support.ts";

export function projectionOrderGroup(options: ProjectionOrderOptions): OrderGroup {
  return new ProjectionOrderGroup(options);
}

interface ProjectionOrderOptions {
  ckbValue: bigint;
  udtValue: bigint;
  isDualRatio: boolean;
  isMatchable: boolean;
  blockNumber?: bigint;
}

class ProjectionOrderCell extends OrderCell {
  private readonly projection: ProjectionOrderOptions;

  constructor(
    projection: ProjectionOrderOptions,
    fields: ConstructorParameters<typeof OrderCell>[0],
  ) {
    super(fields);
    this.projection = projection;
  }

  public override isMatchable(): boolean {
    return this.projection.isMatchable;
  }
}

class ProjectionOrderGroup extends OrderGroup {
  private readonly projection: ProjectionOrderOptions;

  constructor(projection: ProjectionOrderOptions) {
    const order = new ProjectionOrderCell(projection, {
      cell: ccc.Cell.from({
        outPoint: { txHash: hash("77"), index: 0n },
        cellOutput: { capacity: projection.ckbValue, lock: ORDER, type: ICKB_UDT },
        outputData: "0x",
      }),
      data: OrderData.from({
        udtValue: projection.udtValue,
        master: {
          type: "relative",
          value: { distance: 1n, padding: new Uint8Array(32) },
        },
        info: Info.create(!projection.isDualRatio, ratio),
      }),
      ckbUnoccupied: projection.ckbValue,
      absTotal: projection.ckbValue + projection.udtValue,
      absProgress: projection.isMatchable
        ? 0n
        : projection.ckbValue + projection.udtValue,
      blockNumber: projection.blockNumber ?? FRESH_BLOCK,
    });
    super(
      new MasterCell(
        ccc.Cell.from({
          outPoint: { txHash: hash("77"), index: 1n },
          cellOutput: { capacity: 0n, lock: script("11"), type: ORDER },
          outputData: "0x",
        }),
      ),
      order,
      order,
    );
    this.projection = projection;
  }

  public override get ckbValue(): bigint {
    return this.projection.ckbValue;
  }

  public override get udtValue(): bigint {
    return this.projection.udtValue;
  }
}

export function makeOrderGroup(options: {
  ownerLock: ccc.Script;
  txHashByte: string;
  orderTxHashByte?: string;
  ratio?: { ckbScale: bigint; udtScale: bigint };
  isCkb2Udt?: boolean;
  orderCapacity?: bigint;
  udtValue?: bigint;
}): {
  group: OrderGroup;
  masterCell: ccc.Cell;
  orderCell: ccc.Cell;
  originCell: ccc.Cell;
} {
  const masterOutPoint = ccc.OutPoint.from({
    txHash: hash(options.txHashByte),
    index: 1n,
  });
  const orderCell = ccc.Cell.from({
    outPoint: { txHash: hash(options.orderTxHashByte ?? "74"), index: 0n },
    cellOutput: {
      capacity: options.orderCapacity ?? ccc.fixedPointFrom(100),
      lock: ORDER,
      type: ICKB_UDT,
    },
    outputData: OrderData.from({
      udtValue: options.udtValue ?? 0n,
      master: { type: "absolute", value: masterOutPoint },
      info: Info.create(
        options.isCkb2Udt ?? true,
        options.ratio ?? { ckbScale: 1n, udtScale: 1n },
      ),
    }).toBytes(),
  });
  const masterCell = ccc.Cell.from({
    outPoint: masterOutPoint,
    cellOutput: {
      capacity: ccc.fixedPointFrom(61),
      lock: options.ownerLock,
      type: ORDER,
    },
    outputData: "0x",
  });
  const order = OrderCell.mustFrom(orderCell, FRESH_BLOCK);
  const originCell = ccc.Cell.from({
    outPoint: { txHash: masterOutPoint.txHash, index: 0n },
    cellOutput: orderCell.cellOutput,
    outputData: OrderData.from({
      udtValue: options.udtValue ?? 0n,
      master: {
        type: "relative",
        value: { distance: 1n, padding: new Uint8Array(32) },
      },
      info: order.data.info,
    }).toBytes(),
  });
  const origin = OrderCell.mustFrom(originCell, FRESH_BLOCK);

  return {
    group: new OrderGroup(new MasterCell(masterCell), order, origin),
    orderCell,
    masterCell,
    originCell,
  };
}

export async function resolveOrderGroupFixture(cells: {
  masterCell: ccc.Cell;
  orderCell: ccc.Cell;
  originCell: ccc.Cell;
}): Promise<OrderGroup> {
  const originTransaction = ccc.Transaction.default();
  for (const cell of [cells.originCell, cells.masterCell]) {
    originTransaction.outputs.push(cell.cellOutput);
    originTransaction.outputsData.push(cell.outputData);
  }
  const client = new StubClient({
    cells: (query): readonly StubCell[] => [
      query.script_type === "lock" ? cells.orderCell : cells.masterCell,
    ],
    getTransaction: async (txHash): ReturnType<ccc.Client["getTransaction"]> => {
      await Promise.resolve();
      return txHash === cells.masterCell.outPoint.txHash
        ? committedTransactionResponse(originTransaction)
        : undefined;
    },
  });
  const groups = await findOrders(client);
  if (groups.length !== 1 || groups[0] === undefined) {
    throw new Error(
      `Expected one resolved order group, received ${groups.length.toString()}`,
    );
  }
  return groups[0];
}

export const placeholderOrder = projectionOrderGroup({
  ckbValue: 0n,
  udtValue: 0n,
  isDualRatio: false,
  isMatchable: false,
});
