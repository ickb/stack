import { ccc } from "@ckb-ccc/core";
import { convert, type IckbDepositCell, type WithdrawalGroup } from "@ickb/core";
import type { Ratio } from "@ickb/order";
import { compareBigInt } from "@ickb/utils";
import {
  CONVERSION_MATURITY_BUCKET_MS,
  type CkbCumulative,
  type CkbProjection,
  type MaturingCkb,
  type PoolDepositState,
} from "../client/sdk_types.ts";

export function mergeBotCkb(
  left: Map<string, ccc.FixedPoint>,
  right: Map<string, ccc.FixedPoint>,
): Map<string, ccc.FixedPoint> {
  const merged = new Map(left);
  for (const [key, ckbValue] of right) {
    addBotCkb(merged, key, ckbValue);
  }
  return merged;
}

export function botWithdrawalCkb(
  withdrawals: readonly WithdrawalGroup[],
  tip: ccc.ClientBlockHeader,
): { ready: Map<string, ccc.FixedPoint>; maturing: MaturingCkb[] } {
  const ready = new Map<string, ccc.FixedPoint>();
  const maturing: MaturingCkb[] = [];
  for (const withdrawal of withdrawals) {
    if (withdrawal.owned.isReady) {
      addBotCkb(
        ready,
        withdrawal.owner.cell.cellOutput.lock.toHex(),
        withdrawal.ckbValue,
      );
    } else {
      maturing.push({
        ckbValue: withdrawal.ckbValue,
        maturity: withdrawal.owned.maturity.toUnix(tip),
      });
    }
  }
  return { ready, maturing };
}

export function cumulativeCkbMaturing(maturing: readonly MaturingCkb[]): CkbCumulative[] {
  let cumulative = 0n;
  const cumulativeMaturing: CkbCumulative[] = [];
  for (const { ckbValue, maturity } of sortMaturingCkb(maturing)) {
    cumulative += ckbValue;
    cumulativeMaturing.push({ ckbCumulative: cumulative, maturity });
  }
  return cumulativeMaturing;
}

export function sumDirectWithdrawalSurplus(
  deposits: readonly IckbDepositCell[],
  exchangeRatio: Ratio,
): bigint {
  let total = 0n;
  for (const deposit of deposits) {
    total += directWithdrawalSurplus(deposit, exchangeRatio);
  }
  return total;
}

export function poolDepositCkb(
  poolDeposits: PoolDepositState,
  tip: ccc.ClientBlockHeader,
): CkbProjection {
  let ready = 0n;
  const maturing: MaturingCkb[] = [];
  for (const deposit of poolDeposits.deposits) {
    if (deposit.isReady) {
      ready += deposit.ckbValue;
    } else {
      maturing.push({
        ckbValue: deposit.ckbValue,
        maturity: deposit.maturity.toUnix(tip),
      });
    }
  }
  return { ready, maturing };
}

export function addBotCkb(
  botCkb: Map<string, ccc.FixedPoint>,
  key: string,
  ckbValue: ccc.FixedPoint,
): void {
  const reserved = -ccc.fixedPointFrom("2000");
  botCkb.set(key, (botCkb.get(key) ?? reserved) + ckbValue);
}

export function positiveMapValueSum(
  values: ReadonlyMap<string, ccc.FixedPoint>,
): ccc.FixedPoint {
  let total = 0n;
  for (const value of values.values()) {
    if (value > 0n) {
      total += value;
    }
  }
  return total;
}

export function directWithdrawalSurplus(
  deposit: IckbDepositCell,
  exchangeRatio: Ratio,
): bigint {
  return deposit.ckbValue - convert(false, deposit.udtValue, exchangeRatio);
}

export function poolDepositsKey(
  deposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
): string {
  return deposits
    .map((deposit) =>
      [
        deposit.cell.outPoint.toHex(),
        deposit.isReady ? "ready" : "pending",
        String(deposit.ckbValue),
        String(deposit.udtValue),
        String(deposit.maturity.toUnix(tip)),
      ].join("@"),
    )
    .toSorted((left, right) => left.localeCompare(right))
    .join(",");
}

export function sortDepositsByMaturity(
  deposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
): IckbDepositCell[] {
  return deposits.toSorted((left, right) =>
    compareBigInt(left.maturity.toUnix(tip), right.maturity.toUnix(tip)),
  );
}

export function normalizeCountLimit(limit: number): number {
  return Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
}

export function sumUdtValue(deposits: readonly IckbDepositCell[]): bigint {
  let total = 0n;
  for (const deposit of deposits) {
    total += deposit.udtValue;
  }
  return total;
}

export function maturityBucket(maturity: bigint): bigint {
  return maturity / CONVERSION_MATURITY_BUCKET_MS;
}

function sortMaturingCkb(maturing: readonly MaturingCkb[]): MaturingCkb[] {
  return maturing.toSorted((left, right) => compareBigInt(left.maturity, right.maturity));
}
