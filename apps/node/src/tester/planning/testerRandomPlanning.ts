import { convert, ICKB_DEPOSIT_CAP } from "@ickb/sdk";
import type { TesterState } from "../runtime/runtime.ts";
import {
  CKB_TO_ICKB,
  ICKB_TO_CKB,
  type PlannedRawOrder,
  type TesterDirection,
  type TesterFeePolicy,
  type TesterPlan,
} from "../runtime/testerTypes.ts";
import {
  ckbSpendingOrderBudget,
  isActionableRawOrder,
  min,
  planAmounts,
  sampleAmount,
  sampleRatio,
} from "./testerOrderPlanning.ts";

export function hasActionableRandomOrderEstimate(
  state: TesterState,
  depositCapacity: bigint,
  feePolicy: TesterFeePolicy,
): boolean {
  const spendableCkbBalance = ckbSpendingOrderBudget(state.availableCkbBalance);
  return (
    minimumActionableRandomOrderAmount(
      CKB_TO_ICKB,
      min(depositCapacity, spendableCkbBalance),
      state.system,
      feePolicy,
    ) !== undefined ||
    minimumActionableRandomOrderAmount(
      ICKB_TO_CKB,
      min(ICKB_DEPOSIT_CAP, state.availableIckbBalance),
      state.system,
      feePolicy,
    ) !== undefined
  );
}

export function planRandomOrderTransaction(
  state: TesterState,
  depositCapacity: bigint,
  feePolicy: TesterFeePolicy,
  spendableCkbBalance: bigint,
): TesterPlan {
  const ckbMax = min(depositCapacity, spendableCkbBalance);
  const udtMax = min(ICKB_DEPOSIT_CAP, state.availableIckbBalance);
  const ckbMin = minimumActionableRandomOrderAmount(
    CKB_TO_ICKB,
    ckbMax,
    state.system,
    feePolicy,
  );
  const udtMin = minimumActionableRandomOrderAmount(
    ICKB_TO_CKB,
    udtMax,
    state.system,
    feePolicy,
  );
  const ckbWeight =
    ckbMin === undefined ? 0n : convert(true, ckbMax, state.system.exchangeRatio);
  const udtWeight = udtMin === undefined ? 0n : udtMax;
  const isCkb2Udt =
    ckbWeight > 0n &&
    (udtWeight === 0n || sampleRatio(ckbWeight + udtWeight) < ckbWeight);
  if (isCkb2Udt && ckbMin !== undefined) {
    const ckbAmount = sampleAmount(ckbMin, ckbMax);
    return {
      direction: CKB_TO_ICKB,
      amount: ckbAmount,
      ckbAmount,
      udtAmount: 0n,
      orderCount: 1,
    };
  }
  if (udtMin !== undefined) {
    const udtAmount = sampleAmount(udtMin, udtMax);
    return {
      direction: ICKB_TO_CKB,
      amount: udtAmount,
      ckbAmount: 0n,
      udtAmount,
      orderCount: 1,
    };
  }
  return {
    direction: CKB_TO_ICKB,
    amount: 0n,
    ckbAmount: 0n,
    udtAmount: 0n,
    orderCount: 1,
  };
}

function minimumActionableRandomOrderAmount(
  direction: TesterDirection,
  maxAmount: bigint,
  system: TesterState["system"],
  feePolicy: TesterFeePolicy,
): bigint | undefined {
  if (
    maxAmount <= 0n ||
    !isActionableRandomOrderAmount(direction, maxAmount, system, feePolicy)
  ) {
    return undefined;
  }
  let low = 1n;
  let high = maxAmount;
  while (low < high) {
    const mid = (low + high) / 2n;
    if (isActionableRandomOrderAmount(direction, mid, system, feePolicy)) {
      high = mid;
    } else {
      low = mid + 1n;
    }
  }
  return low;
}

function isActionableRandomOrderAmount(
  direction: TesterDirection,
  amount: bigint,
  system: TesterState["system"],
  feePolicy: TesterFeePolicy,
): boolean {
  const order: PlannedRawOrder = {
    direction,
    amounts: planAmounts(direction, amount),
    amount,
  };
  return isActionableRawOrder(order, system, feePolicy);
}
