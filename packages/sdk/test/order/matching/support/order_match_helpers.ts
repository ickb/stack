import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { preparedPartialOrderSerializedSize } from "../../../../src/order/matching/order_match_context.ts";
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
import type { Match } from "../../../../src/order/order.ts";
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
export function exhaustiveIntegerBestMatch(
  orderPool: OrderGroup[],
  allowance: { ckbValue: bigint; udtValue: bigint },
  exchangeRate: { ckbScale: bigint; udtScale: bigint },
  options: {
    feeRate: bigint;
    ckbAllowanceStep: bigint;
    maxPartials?: number;
  },
): Match {
  const orderSize = orderPool.reduce(
    (maxSize, group) => Math.max(maxSize, group.order.cell.occupiedSize),
    0,
  );
  const ckbMiningFee =
    (preparedPartialOrderSerializedSize(orderSize) * options.feeRate + 999n) / 1000n;
  let best = { match: emptyMatch(), gain: 0n };
  const visit = (index: number, match: Match): void => {
    if (index === orderPool.length) {
      const gain = viableOracleGain(match, {
        allowance,
        exchangeRate,
        ckbMiningFee,
        maxPartials: options.maxPartials,
      });
      if (gain !== undefined && gain > best.gain) {
        best = { match, gain };
      }
      return;
    }
    visit(index + 1, match);
    const group = orderPool[index];
    if (group === undefined) {
      return;
    }
    for (const isCkb2Udt of [true, false]) {
      const matcher = OrderMatcher.from(group, isCkb2Udt, ckbMiningFee);
      if (matcher === undefined) {
        continue;
      }
      for (let amount = matcher.bMinMatch; amount <= matcher.bMaxMatch; amount += 1n) {
        const partial = matcher.match(amount);
        if (partial.partials.length === 0) {
          continue;
        }
        visit(index + 1, {
          ckbDelta: match.ckbDelta + partial.ckbDelta,
          udtDelta: match.udtDelta + partial.udtDelta,
          partials: match.partials.concat(partial.partials),
        });
      }
    }
  };
  visit(0, emptyMatch());
  return best.match;
}

function viableOracleGain(
  match: Match,
  options: {
    allowance: { ckbValue: bigint; udtValue: bigint };
    exchangeRate: { ckbScale: bigint; udtScale: bigint };
    ckbMiningFee: bigint;
    maxPartials: number | undefined;
  },
): bigint | undefined {
  const partialCount = match.partials.length;
  const fee = options.ckbMiningFee * BigInt(partialCount);
  if (
    (options.maxPartials !== undefined && partialCount > options.maxPartials) ||
    options.allowance.ckbValue + match.ckbDelta - fee < 0n ||
    options.allowance.udtValue + match.udtDelta < 0n
  ) {
    return undefined;
  }
  return (
    (match.ckbDelta - fee) * options.exchangeRate.ckbScale +
    match.udtDelta * options.exchangeRate.udtScale
  );
}

function emptyMatch(): Match {
  return { ckbDelta: 0n, udtDelta: 0n, partials: [] };
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
      outPoint: partial.group.order.cell.outPoint.toHex(),
      ckbOut: partial.ckbOut,
      udtOut: partial.udtOut,
    })),
  };
}

export function resolvedOrderGroups(orders: OrderCell[]): OrderGroup[] {
  return orders.map(resolvedOrderGroup);
}

export function cycle02ResidualGroups(): OrderGroup[] {
  const specs = [
    [0n, 29n, 1n, 4n],
    [23n, 30n, 8n, 13n],
    [3n, 29n, 6n, 15n],
    [6n, 12n, 4n, 11n],
  ] as const;
  return resolvedOrderGroups(
    specs.map(([ckbUnoccupied, udtValue, ckbScale, udtScale], index) => {
      const ratio = Ratio.from({ ckbScale, udtScale });
      const byte = (index + 1).toString(16).padStart(2, "0");
      return makeOrderCell({
        ckbUnoccupied,
        udtValue,
        info: Info.from({ ckbToUdt: ratio, udtToCkb: ratio, ckbMinMatchLog: 0 }),
        master: {
          type: "absolute",
          value: { txHash: byte32FromByte(byte), index: 1n },
        },
        outPoint: { txHash: byte32FromByte(`a${index.toString()}`), index: 0n },
      });
    }),
  );
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
