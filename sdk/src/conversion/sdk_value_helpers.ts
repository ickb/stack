import type { ccc } from "@ckb-ccc/core";
import { convert, type IckbDepositCell } from "../core/index.ts";
import { sortByMaturity } from "../core/withdrawal_selection.ts";
import type { Ratio } from "../order/index.ts";
import { compareBigInt } from "../utils/index.ts";
import {
  CONVERSION_MATURITY_BUCKET_MS,
  type CkbCumulative,
  type CkbProjection,
  type MaturingCkb,
  type PoolDepositState,
} from "./sdk_types.ts";

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

export function readyPoolDeposits(
  poolDeposits: PoolDepositState,
  tip: ccc.ClientBlockHeader,
): IckbDepositCell[] {
  return sortByMaturity(
    poolDeposits.deposits.filter((deposit) => deposit.isReady),
    tip,
  );
}

export function directWithdrawalSurplus(
  deposit: IckbDepositCell,
  exchangeRatio: Ratio,
): bigint {
  return deposit.ckbValue - convert(false, deposit.udtValue, exchangeRatio);
}

export function sumUdtValue(values: ReadonlyArray<{ udtValue: bigint }>): bigint {
  let total = 0n;
  for (const value of values) {
    total += value.udtValue;
  }
  return total;
}

export function maturityBucket(maturity: bigint): bigint {
  return maturity / CONVERSION_MATURITY_BUCKET_MS;
}

function sortMaturingCkb(maturing: readonly MaturingCkb[]): MaturingCkb[] {
  return maturing.toSorted((left, right) => compareBigInt(left.maturity, right.maturity));
}
