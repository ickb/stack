import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP, type IckbDepositCell } from "@ickb/core";

export const CKB = ccc.fixedPointFrom(1);
export const CKB_RESERVE = 1000n * CKB;
export const MIN_ICKB_BALANCE = 2000n * CKB;
export const TARGET_ICKB_BALANCE = ICKB_DEPOSIT_CAP + 20000n * CKB;

const MAX_WITHDRAWAL_REQUESTS = 30;

export type RebalancePlan =
  | { kind: "none" }
  | { kind: "deposit"; quantity: 1 }
  | { kind: "withdraw"; deposits: IckbDepositCell[] };

export function planRebalance(options: {
  outputSlots: number;
  ickbBalance: bigint;
  ckbBalance: bigint;
  depositCapacity: bigint;
  readyDeposits: readonly IckbDepositCell[];
}): RebalancePlan {
  const {
    outputSlots,
    ickbBalance,
    ckbBalance,
    depositCapacity,
    readyDeposits,
  } =
    options;

  if (outputSlots < 2) {
    return { kind: "none" };
  }

  if (ickbBalance < MIN_ICKB_BALANCE) {
    if (ckbBalance >= depositCapacity + CKB_RESERVE) {
      return { kind: "deposit", quantity: 1 };
    }
    return { kind: "none" };
  }

  const excessIckb = ickbBalance - TARGET_ICKB_BALANCE;
  if (excessIckb <= 0n) {
    return { kind: "none" };
  }

  const deposits = selectReadyDeposits(
    readyDeposits,
    excessIckb,
    Math.min(MAX_WITHDRAWAL_REQUESTS, Math.floor(outputSlots / 2)),
  );
  return deposits.length === 0
    ? { kind: "none" }
    : { kind: "withdraw", deposits };
}

export function selectReadyDeposits<T extends { udtValue: bigint }>(
  deposits: readonly T[],
  maxAmount: bigint,
  limit = MAX_WITHDRAWAL_REQUESTS,
): T[] {
  if (maxAmount <= 0n || limit <= 0) {
    return [];
  }

  const selected: T[] = [];
  let cumulative = 0n;

  for (const deposit of deposits) {
    if (selected.length >= limit) {
      break;
    }

    if (cumulative + deposit.udtValue > maxAmount) {
      continue;
    }

    cumulative += deposit.udtValue;
    selected.push(deposit);
  }

  return selected;
}
