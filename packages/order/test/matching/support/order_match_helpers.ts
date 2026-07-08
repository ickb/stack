import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { OrderCell } from "../../../src/model/cells.ts";
import { Info } from "../../../src/model/info.ts";
import { OrderData } from "../../../src/model/order_data.ts";
import { Ratio } from "../../../src/model/ratio.ts";
import { OrderManager, OrderMatcher, type Match } from "../../../src/order.ts";
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
  const matcher = OrderMatcher.from(order, isCkb2Udt, 0n);
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
export function exhaustiveSequentialBestMatch(
  orderPool: OrderCell[],
  allowance: { ckbValue: bigint; udtValue: bigint },
  exchangeRate: { ckbScale: bigint; udtScale: bigint },
  options: {
    feeRate: bigint;
    ckbAllowanceStep: bigint;
    maxPartials?: number;
  },
): Match {
  const orderSize = orderPool.reduce(
    (maxSize, order) => Math.max(maxSize, order.cell.occupiedSize),
    0,
  );
  const ckbMiningFee = (ccc.numFrom(36 + orderSize) * options.feeRate + 999n) / 1000n;
  const udtAllowanceStep =
    (options.ckbAllowanceStep * exchangeRate.ckbScale + exchangeRate.udtScale - 1n) /
    exchangeRate.udtScale;
  let best: Match = { ckbDelta: 0n, udtDelta: 0n, partials: [] };
  let bestGain = 0n;
  for (const c2u of OrderManager.sequentialMatcher(
    orderPool,
    true,
    udtAllowanceStep,
    ckbMiningFee,
  )) {
    for (const u2c of OrderManager.sequentialMatcher(
      orderPool,
      false,
      options.ckbAllowanceStep,
      ckbMiningFee,
    )) {
      const partials = c2u.partials.concat(u2c.partials);
      if (options.maxPartials !== undefined && partials.length > options.maxPartials) {
        continue;
      }
      if (!hasUniquePartialOrderOutPoints(partials)) {
        continue;
      }

      const ckbDelta = c2u.ckbDelta + u2c.ckbDelta;
      const udtDelta = c2u.udtDelta + u2c.udtDelta;
      const ckbFee = ckbMiningFee * BigInt(partials.length);
      const ckbAllowance = allowance.ckbValue + ckbDelta - ckbFee;
      const udtAllowance = allowance.udtValue + udtDelta;
      const gain =
        (ckbDelta - ckbFee) * exchangeRate.ckbScale + udtDelta * exchangeRate.udtScale;

      if (ckbAllowance >= 0n && udtAllowance >= 0n && gain > bestGain) {
        best = { ckbDelta, udtDelta, partials };
        bestGain = gain;
      }
    }
  }
  return best;
}

function hasUniquePartialOrderOutPoints(partials: Match["partials"]): boolean {
  const seen = new Set<string>();
  for (const partial of partials) {
    const key = partial.order.cell.outPoint.toHex();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return true;
}

export function matchKey(match: Match): {
  ckbDelta: bigint;
  udtDelta: bigint;
  partials: Array<{ outPoint: ccc.Hex; ckbOut: bigint; udtOut: bigint }>;
} {
  return {
    ckbDelta: match.ckbDelta,
    udtDelta: match.udtDelta,
    partials: match.partials.map((partial) => ({
      outPoint: partial.order.cell.outPoint.toHex(),
      ckbOut: partial.ckbOut,
      udtOut: partial.udtOut,
    })),
  };
}
