import { ICKB_DEPOSIT_CAP } from "@ickb/sdk";
import type { TesterState } from "../runtime/runtime.ts";
import {
  CKB_RESERVE,
  CKB_TO_ICKB,
  DEFAULT_TESTER_FEE_POLICY,
  ICKB_TO_CKB,
  TesterTerminalError,
  type PlannedRawOrder,
  type TesterDirection,
  type TesterPlan,
} from "../runtime/testerTypes.ts";
import {
  estimateRawOrder,
  isBuildableSdkConversionOrder,
  min,
  planAmounts,
} from "./testerOrderPlanning.ts";

export function hasBuildableSdkConversionEstimate(
  state: TesterState,
  depositCapacity: bigint,
  allowDustIckbToCkb = true,
): boolean {
  try {
    planSdkConversionTransaction(state, depositCapacity, allowDustIckbToCkb);
    return true;
  } catch (error) {
    if (error instanceof TesterTerminalError) {
      return false;
    }
    throw error;
  }
}

export function planSdkConversionTransaction(
  state: TesterState,
  depositCapacity: bigint,
  allowDustIckbToCkb = true,
): TesterPlan {
  const spendableCkbBalance =
    state.availableCkbBalance >= CKB_RESERVE + depositCapacity ? depositCapacity : 0n;
  if (spendableCkbBalance > 0n) {
    const ckbPlan = buildableSdkConversionPlan({
      state,
      direction: CKB_TO_ICKB,
      amount: spendableCkbBalance,
      depositCapacity,
      allowDustIckbToCkb,
    });
    if (ckbPlan !== undefined) {
      return ckbPlan;
    }
  }
  const udtPlan = buildableSdkConversionPlan({
    state,
    direction: ICKB_TO_CKB,
    amount: min(ICKB_DEPOSIT_CAP, state.availableIckbBalance),
    depositCapacity,
    allowDustIckbToCkb,
  });
  if (udtPlan !== undefined) {
    return udtPlan;
  }
  throw new TesterTerminalError("Not enough funds for SDK conversion scenario");
}

function buildableSdkConversionPlan({
  state,
  direction,
  amount,
  depositCapacity,
  allowDustIckbToCkb = true,
}: {
  state: TesterState;
  direction: TesterDirection;
  amount: bigint;
  depositCapacity: bigint;
  allowDustIckbToCkb?: boolean;
}): TesterPlan | undefined {
  if (amount <= 0n) {
    return undefined;
  }
  const order: PlannedRawOrder = {
    direction,
    amounts: planAmounts(direction, amount),
    amount,
  };
  const estimate = estimateRawOrder(order, state.system, DEFAULT_TESTER_FEE_POLICY);
  if (estimate === undefined || estimate.convertedAmount <= 0n) {
    return undefined;
  }
  const plan = {
    direction,
    amount,
    ckbAmount: direction === CKB_TO_ICKB ? amount : 0n,
    udtAmount: direction === ICKB_TO_CKB ? amount : 0n,
    orderCount: 1,
  };
  return isBuildableSdkConversionOrder({
    plan,
    order,
    estimate,
    system: state.system,
    depositCapacity,
    allowDustIckbToCkb,
  })
    ? plan
    : undefined;
}
