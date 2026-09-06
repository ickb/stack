import type { ccc } from "@ckb-ccc/core";
import {
  attemptedOrderEvidence,
  testerEstimatedTooSmallSkip,
  testerNoActionableAutoScenarioSkip,
  testerSdkConversionNoticeSkip,
} from "../evidence/testerEvidence.ts";
import {
  buildSdkConversionTransaction,
  type Runtime,
  type TesterState,
} from "../runtime/runtime.ts";
import { stopForLowTesterCapital } from "../runtime/testerStop.ts";
import {
  DEFAULT_TESTER_FEE_POLICY,
  MIN_TOTAL_CAPITAL_DIVISOR,
  type EstimatedRawOrder,
  type ExecutionLog,
  type PlannedRawOrder,
  type TesterFeePolicy,
  type TesterPlan,
  type TesterScenario,
  type TesterScenarioSelection,
  type TesterSkip,
} from "../runtime/testerTypes.ts";
import {
  estimateTesterRawOrders,
  hasTooSmallTesterRawOrder,
} from "./testerAttemptEstimate.ts";
import {
  buildPlannedRawOrderTransaction,
  isSdkConversionScenario,
  plannedRawOrders,
  planTesterTransaction,
  resolveTesterScenario,
} from "./testerPlanning.ts";

export interface PlannedTesterAttempt {
  effectiveTesterScenario: TesterScenario;
  effectiveFeePolicy: TesterFeePolicy;
  rawOrders: PlannedRawOrder[];
  estimatedOrders: EstimatedRawOrder[];
  built:
    | Awaited<ReturnType<typeof buildSdkConversionTransaction>>
    | {
        tx: ccc.Transaction;
        conversion: undefined;
        conversionNotice: undefined;
      };
}

interface PlanTesterAttemptOptions {
  runtime: Runtime;
  state: TesterState;
  testerScenario: TesterScenarioSelection;
  feePolicy: TesterFeePolicy;
  depositCapacity: bigint;
  totalEquivalentCkb: bigint;
  executionLog: ExecutionLog;
}
interface CapitalSkipOptions {
  executionLog: ExecutionLog;
  totalEquivalentCkb: bigint;
  depositCapacity: bigint;
}
export async function planTesterAttempt({
  runtime,
  state,
  testerScenario,
  feePolicy,
  depositCapacity,
  totalEquivalentCkb,
  executionLog,
}: PlanTesterAttemptOptions): Promise<PlannedTesterAttempt | undefined> {
  const log = executionLog;
  const capitalSkipOptions = { executionLog, totalEquivalentCkb, depositCapacity };
  const effectiveTesterScenario = resolveTesterScenario({
    state,
    scenario: testerScenario,
    feePolicy,
    depositCapacity,
    // A dust order is always affordable, so below the capital minimum it must not keep a
    // depleted tester cycling instead of holding with exit 2.
    allowDust: totalEquivalentCkb >= depositCapacity / MIN_TOTAL_CAPITAL_DIVISOR,
  });
  if (effectiveTesterScenario === undefined) {
    skipBeforePlanning(capitalSkipOptions, testerNoActionableAutoScenarioSkip());
    return undefined;
  }
  const plan = planTesterTransaction(
    state,
    depositCapacity,
    effectiveTesterScenario,
    feePolicy,
  );
  const rawOrders = plannedRawOrders(plan, effectiveTesterScenario);
  if (rawOrders.length === 0) {
    skipBeforePlanning(capitalSkipOptions, { reason: "sampled-amount-too-small" });
    return undefined;
  }
  const effectiveFeePolicy = isSdkConversionScenario(effectiveTesterScenario)
    ? DEFAULT_TESTER_FEE_POLICY
    : feePolicy;
  const estimatedOrders = estimateActionableTesterOrders({
    executionLog,
    requestedScenario: testerScenario,
    effectiveScenario: effectiveTesterScenario,
    rawOrders,
    state,
    feePolicy: effectiveFeePolicy,
  });
  if (estimatedOrders === undefined) {
    return undefined;
  }
  const built = await buildTesterAttemptTransaction({
    runtime,
    state,
    plan,
    effectiveTesterScenario,
    estimatedOrders,
  });
  if (
    built.conversion !== undefined &&
    built.conversionNotice?.kind === "dust-ickb-to-ckb"
  ) {
    log.skip = testerSdkConversionNoticeSkip({
      requestedScenario: testerScenario,
      effectiveScenario: effectiveTesterScenario,
      conversion: built.conversion,
      conversionNotice: built.conversionNotice,
      orderEvidence: attemptedOrderEvidence(
        rawOrders,
        estimatedOrders,
        effectiveFeePolicy,
      ),
    });
    return undefined;
  }
  return {
    effectiveTesterScenario,
    effectiveFeePolicy,
    rawOrders,
    estimatedOrders,
    built,
  };
}
function estimateActionableTesterOrders({
  executionLog,
  requestedScenario,
  effectiveScenario,
  rawOrders,
  state,
  feePolicy,
}: {
  executionLog: ExecutionLog;
  requestedScenario: TesterScenarioSelection;
  effectiveScenario: TesterScenario;
  rawOrders: PlannedRawOrder[];
  state: TesterState;
  feePolicy: TesterFeePolicy;
}): EstimatedRawOrder[] | undefined {
  const log = executionLog;
  const estimatedOrders = estimateTesterRawOrders(rawOrders, state, feePolicy);
  if (
    estimatedOrders === undefined ||
    hasTooSmallTesterRawOrder(estimatedOrders, state, effectiveScenario)
  ) {
    log.skip = testerEstimatedTooSmallSkip({
      requestedScenario,
      effectiveScenario,
      rawOrders,
      estimatedOrders: estimatedOrders ?? [],
      feePolicy,
    });
    return undefined;
  }
  return estimatedOrders;
}
/** Records the skip, unless capital is so low that the turn stops for good instead. */
function skipBeforePlanning(
  { executionLog, totalEquivalentCkb, depositCapacity }: CapitalSkipOptions,
  skip: TesterSkip,
): undefined {
  if (totalEquivalentCkb < depositCapacity / MIN_TOTAL_CAPITAL_DIVISOR) {
    stopForLowTesterCapital(executionLog);
    return;
  }
  const log = executionLog;
  log.skip = skip;
}
async function buildTesterAttemptTransaction({
  runtime,
  state,
  plan,
  effectiveTesterScenario,
  estimatedOrders,
}: {
  runtime: Runtime;
  state: TesterState;
  plan: TesterPlan;
  effectiveTesterScenario: TesterScenario;
  estimatedOrders: EstimatedRawOrder[];
}): Promise<PlannedTesterAttempt["built"]> {
  if (isSdkConversionScenario(effectiveTesterScenario)) {
    return buildSdkConversionTransaction(runtime, state, plan.direction, plan.amount);
  }
  return {
    tx: await buildPlannedRawOrderTransaction(runtime, state, estimatedOrders),
    conversion: undefined,
    conversionNotice: undefined,
  };
}
