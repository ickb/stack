import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { OrderMatcher } from "../../../../src/order/matching/order_matcher.ts";
import {
  attestResolvedOrderGroup,
  MasterCell,
  OrderCell,
  OrderGroup,
} from "../../../../src/order/model/cells.ts";
import { Info } from "../../../../src/order/model/info.ts";
import { OrderData } from "../../../../src/order/model/order_data.ts";
import { Ratio } from "../../../../src/order/model/ratio.ts";
import { Relative } from "../../../../src/order/model/relative.ts";
import { makeOrderCell } from "./order_order_helpers.ts";

type ExactAdjustedConversionArgs = [
  isCkb2Udt: boolean,
  ratio: Ratio,
  amount: ccc.FixedPoint,
  fee: bigint,
  feeBase: bigint,
];

export function exactAdjustedConversion(
  ...[isCkb2Udt, ratio, amount, fee, feeBase]: ExactAdjustedConversionArgs
): ccc.FixedPoint {
  let { ckbScale: aScale, udtScale: bScale } = ratio;
  if (!isCkb2Udt) {
    [aScale, bScale] = [bScale, aScale];
  }
  aScale *= feeBase - fee;
  bScale *= feeBase;
  const divisor = ccc.gcd(aScale, bScale);
  aScale /= divisor;
  bScale /= divisor;
  return (amount * aScale + bScale - 1n) / bScale;
}

export function fullMatchOutput(
  isCkb2Udt: boolean,
  info: Info,
  amounts: { ckbValue: bigint; udtValue: bigint },
): bigint {
  const order = makeOrderCell({
    ckbUnoccupied: amounts.ckbValue,
    udtValue: amounts.udtValue,
    info,
    master: {
      type: "absolute",
      value: { txHash: byte32FromByte("77"), index: 1n },
    },
    outPoint: { txHash: byte32FromByte("78"), index: 0n },
  });
  const matcher = OrderMatcher.from(resolvedOrderGroup(order), isCkb2Udt, 0n);
  if (matcher === undefined) {
    throw new Error("Expected order matcher");
  }
  return matcher.bMaxMatch;
}

export function makeUdtToCkbOrder(options?: {
  txHashByte?: string;
  orderTxHashByte?: string;
  udtValue?: ccc.FixedPoint;
  lockArgs?: ccc.Hex;
}): OrderCell {
  const orderScript = ccc.Script.from({
    codeHash: byte32FromByte("11"),
    hashType: "type",
    args: options?.lockArgs ?? "0x",
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
export function resolvedOrderGroups(orders: OrderCell[]): OrderGroup[] {
  return orders.map(resolvedOrderGroup);
}

export function resolvedOrderGroup(order: OrderCell): OrderGroup {
  const masterOutPoint = order.getMaster();
  const originIndex = masterOutPoint.index === 0n ? 1n : masterOutPoint.index - 1n;
  const origin = order.data.isMint()
    ? order
    : makeOrderCell({
        ckbUnoccupied: order.ckbUnoccupied,
        udtValue: order.udtValue,
        info: order.data.info,
        lock: order.cell.cellOutput.lock,
        master: {
          type: "relative",
          value: Relative.create(masterOutPoint.index - originIndex),
        },
        outPoint: { txHash: masterOutPoint.txHash, index: originIndex },
      });
  const master = new MasterCell(
    ccc.Cell.from({
      outPoint: masterOutPoint,
      cellOutput: {
        capacity: 61n,
        lock: ccc.Script.from({
          codeHash: byte32FromByte("aa"),
          hashType: "type",
          args: "0x",
        }),
        type: order.cell.cellOutput.lock,
      },
      outputData: "0x",
    }),
  );
  const group = new OrderGroup(master, order, origin);
  return attestResolvedOrderGroup(group);
}
