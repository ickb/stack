import type { ccc } from "@ckb-ccc/core";
import { estimateMaturityFeeThreshold, IckbSdk } from "@ickb/sdk";
import {
  buildRawOrderTransaction,
  type RawOrderRequest,
  type Runtime,
  type TesterState,
} from "../runtime/runtime.ts";
import {
  CKB_RESERVE,
  CKB_SPENDING_ORDER_OVERHEAD,
  CKB_TO_ICKB,
  ICKB_TO_CKB,
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  RANDOM_SCALE,
  SDK_CONVERSION_SCENARIO,
  type EstimatedRawOrder,
  type PlannedRawOrder,
  type TesterDirection,
  type TesterFeePolicy,
  type TesterPlan,
  type TesterScenario,
} from "../runtime/testerTypes.ts";

export function plannedRawOrders(
  plan: TesterPlan,
  scenario: TesterScenario,
): PlannedRawOrder[] {
  if (plan.amount <= 0n) {
    return [];
  }
  if (isSdkConversionScenario(scenario)) {
    return [
      {
        direction: plan.direction,
        amounts: planAmounts(plan.direction, plan.amount),
        amount: plan.amount,
      },
    ];
  }
  if (scenario === MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO) {
    const orders: PlannedRawOrder[] = [
      {
        direction: CKB_TO_ICKB,
        amounts: { ckbValue: plan.ckbAmount, udtValue: 0n },
        amount: plan.ckbAmount,
      },
      {
        direction: ICKB_TO_CKB,
        amounts: { ckbValue: 0n, udtValue: plan.udtAmount },
        amount: plan.udtAmount,
      },
    ];
    return orders.filter((order) => order.amount > 0n);
  }
  if (plan.orderCount === 2) {
    const firstAmount = plan.amount / 2n;
    const secondAmount = plan.amount - firstAmount;
    return [firstAmount, secondAmount]
      .filter((amount) => amount > 0n)
      .map((amount) => ({
        direction: plan.direction,
        amounts: planAmounts(plan.direction, amount),
        amount,
      }));
  }
  return [
    {
      direction: plan.direction,
      amounts: planAmounts(plan.direction, plan.amount),
      amount: plan.amount,
    },
  ];
}

export async function buildPlannedRawOrderTransaction(
  runtime: Runtime,
  state: TesterState,
  orders: EstimatedRawOrder[],
): Promise<ccc.Transaction> {
  const rawOrders: RawOrderRequest[] = orders.map((order) => ({
    amounts: order.amounts,
    info: order.estimate.info,
  }));
  return buildRawOrderTransaction(runtime, state, rawOrders);
}

export function isActionableRawOrder(
  order: PlannedRawOrder,
  system: TesterState["system"],
  feePolicy: TesterFeePolicy,
): boolean {
  const estimate = estimateRawOrder(order, system, feePolicy);
  return (
    estimate !== undefined &&
    isActionableEstimatedRawOrder({ ...order, estimate }, system)
  );
}

export function isActionableEstimatedRawOrder(
  order: EstimatedRawOrder,
  system: TesterState["system"],
): boolean {
  return (
    order.estimate.convertedAmount > 0n &&
    order.estimate.ckbFee >= estimateMaturityFeeThreshold(system)
  );
}

export function estimateRawOrder(
  order: PlannedRawOrder,
  system: TesterState["system"],
  feePolicy: TesterFeePolicy,
): ReturnType<typeof IckbSdk.estimate> | undefined {
  try {
    return IckbSdk.estimate(order.direction === CKB_TO_ICKB, order.amounts, system, {
      fee: feePolicy.fee,
      feeBase: feePolicy.feeBase,
    });
  } catch (error) {
    if (isUnrepresentableTesterEstimateError(error)) {
      return undefined;
    }
    throw error;
  }
}

export function isBuildableSdkConversionOrder({
  plan,
  order,
  estimate,
  system,
  depositCapacity,
  allowDustIckbToCkb,
}: {
  plan: TesterPlan;
  order: PlannedRawOrder;
  estimate: ReturnType<typeof IckbSdk.estimate>;
  system: TesterState["system"];
  depositCapacity: bigint;
  allowDustIckbToCkb: boolean;
}): boolean {
  if (order.direction === CKB_TO_ICKB) {
    return plan.amount >= depositCapacity || estimate.maturity !== undefined;
  }
  const orderEstimate = IckbSdk.estimateIckbToCkbOrder(order.amounts, system);
  return (
    orderEstimate !== undefined &&
    (allowDustIckbToCkb || orderEstimate.notice?.kind !== "dust-ickb-to-ckb")
  );
}

export function ckbSpendingOrderBudget(availableCkbBalance: bigint): bigint {
  return max(0n, availableCkbBalance - CKB_RESERVE - CKB_SPENDING_ORDER_OVERHEAD);
}

export function sampleAmount(minimum: bigint, maximum: bigint): bigint {
  return minimum + sampleRatio(maximum - minimum + 1n);
}

export function sampleRatio(amount: bigint): bigint {
  if (amount <= 0n) {
    return 0n;
  }
  return (amount * randomScaled()) / RANDOM_SCALE;
}

export function planAmounts(
  direction: TesterDirection,
  amount: bigint,
): { ckbValue: bigint; udtValue: bigint } {
  return direction === CKB_TO_ICKB
    ? { ckbValue: amount, udtValue: 0n }
    : { ckbValue: 0n, udtValue: amount };
}

export function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

export function isSdkConversionScenario(scenario: TesterScenario): boolean {
  return scenario === SDK_CONVERSION_SCENARIO;
}

export function isUnrepresentableTesterEstimateError(error: unknown): boolean {
  return error instanceof Error && error.name === "OrderConversionRepresentabilityError";
}

function randomScaled(): bigint {
  // eslint-disable-next-line sonarjs/pseudo-random -- Tester scenario sampling intentionally uses non-cryptographic randomness.
  return BigInt(Math.floor(Math.random() * Number(RANDOM_SCALE)));
}

function max(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
