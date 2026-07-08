import { ccc } from "@ckb-ccc/core";
import { Info, MasterCell, OrderCell, OrderData, OrderGroup } from "@ickb/order";
import { script } from "@ickb/testkit";
import { hash, ratio } from "../../../transaction/base/support/sdk_core_support.ts";

export function projectionOrderGroup(options: ProjectionOrderOptions): OrderGroup {
  const group = new ProjectionOrderGroup(options);
  group.order.isDualRatio = (): boolean => options.isDualRatio;
  group.order.isMatchable = (): boolean => options.isMatchable;
  return group;
}

interface ProjectionOrderOptions {
  ckbValue: bigint;
  udtValue: bigint;
  isDualRatio: boolean;
  isMatchable: boolean;
}

class ProjectionOrderGroup extends OrderGroup {
  private readonly projection: ProjectionOrderOptions;

  constructor(projection: ProjectionOrderOptions) {
    const order = new OrderCell(
      ccc.Cell.from({
        outPoint: { txHash: hash("77"), index: 0n },
        cellOutput: { capacity: projection.ckbValue, lock: script("55") },
        outputData: "0x",
      }),
      OrderData.from({
        udtValue: projection.udtValue,
        master: {
          type: "relative",
          value: { distance: 1n, padding: new Uint8Array(32) },
        },
        info: Info.create(!projection.isDualRatio, ratio),
      }),
      projection.ckbValue,
      projection.ckbValue + projection.udtValue,
      projection.isMatchable ? 0n : projection.ckbValue + projection.udtValue,
      undefined,
    );
    super(
      new MasterCell(
        ccc.Cell.from({
          outPoint: { txHash: hash("77"), index: 1n },
          cellOutput: { capacity: 0n, lock: script("11"), type: script("55") },
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
  orderScript: ccc.Script;
  udtScript: ccc.Script;
  ownerLock: ccc.Script;
  txHashByte: string;
  orderTxHashByte?: string;
  ratio?: { ckbScale: bigint; udtScale: bigint };
  isCkb2Udt?: boolean;
  orderCapacity?: bigint;
  udtValue?: bigint;
}): { group: OrderGroup; orderCell: ccc.Cell; masterCell: ccc.Cell } {
  const masterOutPoint = ccc.OutPoint.from({
    txHash: hash(options.txHashByte),
    index: 1n,
  });
  const orderCell = ccc.Cell.from({
    outPoint: { txHash: hash(options.orderTxHashByte ?? "74"), index: 0n },
    cellOutput: {
      capacity: options.orderCapacity ?? ccc.fixedPointFrom(100),
      lock: options.orderScript,
      type: options.udtScript,
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
      type: options.orderScript,
    },
    outputData: "0x",
  });
  const order = OrderCell.mustFrom(orderCell);

  return {
    group: new OrderGroup(new MasterCell(masterCell), order, order),
    orderCell,
    masterCell,
  };
}

export const placeholderOrder = projectionOrderGroup({
  ckbValue: 0n,
  udtValue: 0n,
  isDualRatio: false,
  isMatchable: false,
});
