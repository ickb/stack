import { ccc } from "@ckb-ccc/core";
import { convert, type IckbDepositCell } from "../core/index.ts";
import type { Info } from "../order/info.ts";
import type { Ratio } from "../order/ratio.ts";
import { binarySearch, compareBigInt, type ValueComponents } from "../utils/index.ts";
import type { CkbCumulative, MaturityOrderInput, SystemState } from "./types.ts";

export function maturity(o: MaturityOrderInput, system: SystemState): bigint | undefined {
  const { info, amounts } = maturityOrderParts(o);
  if (info.isDualRatio()) {
    return undefined;
  }

  const isCkb2Udt = info.isCkb2Udt();
  const amount = orderSideAmount(isCkb2Udt, amounts);
  if (amount === 0n) {
    return 0n;
  }

  return isCkb2Udt
    ? ckbToIckbOrderMaturity(info, amount, system)
    : ickbToCkbOrderMaturity(info, amounts, amount, system);
}

function maturityOrderParts(o: MaturityOrderInput): {
  info: Info;
  amounts: ValueComponents;
} {
  if ("info" in o) {
    return o;
  }

  return {
    info: o.data.info,
    amounts: { ckbValue: o.ckbUnoccupied, udtValue: o.udtValue },
  };
}

function orderSideAmount(isCkb2Udt: boolean, amounts: ValueComponents): bigint {
  return isCkb2Udt ? amounts.ckbValue : amounts.udtValue;
}

function ckbToIckbOrderMaturity(info: Info, amount: bigint, system: SystemState): bigint {
  const pressure = orderPoolPressure(true, info.ckbToUdt, system);
  const ckb = amount + pressure.ckb - convert(false, pressure.udt, system.exchangeRatio);
  const baseMaturity = 10n * 60n * 1000n;
  const maturityValue =
    ckb > 0n ? baseMaturity * (1n + ckb / ccc.fixedPointFrom("200000")) : baseMaturity;
  return maturityValue + system.tip.timestamp;
}

function ickbToCkbOrderMaturity(
  info: Info,
  amounts: ValueComponents,
  amount: bigint,
  system: SystemState,
): bigint | undefined {
  const ratio = info.udtToCkb;
  const pressure = orderPoolPressure(false, ratio, system);
  const orderCkb = amounts.ckbValue - ratio.convert(false, amount, true);
  const ckb =
    orderCkb +
    pressure.ckb -
    convert(false, pressure.udt, system.exchangeRatio) +
    system.ckbAvailable;
  const baseMaturity = 10n * 60n * 1000n;
  if (ckb >= 0n) {
    return baseMaturity + system.tip.timestamp;
  }

  return firstCkbMaturityAtOrAbove(system.ckbMaturing, -ckb);
}

function orderPoolPressure(
  isCkb2Udt: boolean,
  reference: Ratio,
  system: SystemState,
): { ckb: bigint; udt: bigint } {
  let ckb = 0n;
  let udt = 0n;
  for (const { order } of system.orderPool) {
    const info = order.data.info;
    if (shouldCountCkbOrder(isCkb2Udt, info, reference)) {
      ckb += order.ckbUnoccupied;
    }
    if (shouldCountUdtOrder(isCkb2Udt, info, reference)) {
      udt += order.udtValue;
    }
  }
  return { ckb, udt };
}

function shouldCountCkbOrder(isCkb2Udt: boolean, info: Info, reference: Ratio): boolean {
  return info.isCkb2Udt() && (!isCkb2Udt || info.ckbToUdt.compare(reference) < 0);
}

function shouldCountUdtOrder(isCkb2Udt: boolean, info: Info, reference: Ratio): boolean {
  return !info.isCkb2Udt() && (isCkb2Udt || reference.compare(info.udtToCkb) < 0);
}

function firstCkbMaturityAtOrAbove(
  ckbMaturing: readonly CkbCumulative[],
  ckbNeeded: bigint,
): bigint | undefined {
  const index = binarySearch(ckbMaturing.length, (n) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- binarySearch probes 0 <= n < ckbMaturing.length.
    return ckbMaturing[n]!.ckbCumulative >= ckbNeeded;
  });
  if (index >= ckbMaturing.length) {
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index is checked against ckbMaturing.length above.
  return ckbMaturing[index]!.maturity;
}

/**
 * The CKB the pool can fill orders with: ready deposits now, the rest as cumulative
 * buckets at their claim dates, earliest first.
 */
export function poolCkb(
  poolDeposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
): { ready: bigint; maturing: CkbCumulative[] } {
  let ready = 0n;
  const maturing = poolDeposits
    .filter((deposit) => !deposit.isReady)
    .map((deposit) => ({
      ckbValue: deposit.ckbValue,
      maturity: deposit.maturity.toUnix(tip),
    }))
    .toSorted((left, right) => compareBigInt(left.maturity, right.maturity));
  for (const deposit of poolDeposits) {
    if (deposit.isReady) {
      ready += deposit.ckbValue;
    }
  }
  let cumulative = 0n;
  return {
    ready,
    maturing: maturing.map(({ ckbValue, maturity: at }) => {
      cumulative += ckbValue;
      return { ckbCumulative: cumulative, maturity: at };
    }),
  };
}
