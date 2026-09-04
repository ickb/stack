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
  createExecutionLogWriter,
  DEFAULT_TESTER_FEE_POLICY,
  MIN_TOTAL_CAPITAL_DIVISOR,
  type EstimatedRawOrder,
  type ExecutionLog,
  type ExecutionLogWriter,
  type PlannedRawOrder,
  type TesterFeePolicy,
  type TesterPlan,
  type TesterScenario,
  type TesterScenarioSelection,
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
  executionLogWriter?: ExecutionLogWriter;
}
interface CapitalSkipOptions {
  executionLog: ExecutionLog;
  executionLogWriter: ExecutionLogWriter;
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
  executionLogWriter = createExecutionLogWriter(executionLog),
}: PlanTesterAttemptOptions): Promise<PlannedTesterAttempt | undefined> {
  const capitalSkipOptions = {
    executionLog,
    executionLogWriter,
    totalEquivalentCkb,
    depositCapacity,
  };
  const effectiveTesterScenario = resolveTesterScenario({
    state,
    scenario: testerScenario,
    feePolicy,
    depositCapacity,
  });
  if (effectiveTesterScenario === undefined) {
    return skipUnfundedAutoScenario(capitalSkipOptions);
  }
  const plan = planTesterTransaction(
    state,
    depositCapacity,
    effectiveTesterScenario,
    feePolicy,
  );
  const rawOrders = plannedRawOrders(plan, effectiveTesterScenario);
  if (rawOrders.length === 0) {
    return skipEmptyRawOrders(capitalSkipOptions);
  }
  const effectiveFeePolicy = isSdkConversionScenario(effectiveTesterScenario)
    ? DEFAULT_TESTER_FEE_POLICY
    : feePolicy;
  const estimatedOrders = estimateActionableTesterOrders({
    executionLogWriter,
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
  if (built.conversionNotice?.kind === "dust-ickb-to-ckb") {
    executionLogWriter.record({
      skip: testerSdkConversionNoticeSkip(
        testerScenario,
        effectiveTesterScenario,
        built.conversion,
        built.conversionNotice,
        attemptedOrderEvidence(rawOrders, estimatedOrders, effectiveFeePolicy),
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
  executionLogWriter,
  requestedScenario,
  effectiveScenario,
  rawOrders,
  state,
  feePolicy,
}: {
  executionLogWriter: ExecutionLogWriter;
  requestedScenario: TesterScenarioSelection;
  effectiveScenario: TesterScenario;
  rawOrders: PlannedRawOrder[];
  state: TesterState;
  feePolicy: TesterFeePolicy;
}): EstimatedRawOrder[] | undefined {
  const estimatedOrders = estimateTesterRawOrders(rawOrders, state, feePolicy);
  if (estimatedOrders === undefined) {
    recordTesterEstimatedTooSmallSkip({
      executionLogWriter,
      requestedScenario,
      effectiveScenario,
      rawOrders,
      estimatedOrders: [],
      feePolicy,
    });
    return undefined;
  }
  if (hasTooSmallTesterRawOrder(estimatedOrders, state, effectiveScenario)) {
    recordTesterEstimatedTooSmallSkip({
      executionLogWriter,
      requestedScenario,
      effectiveScenario,
      rawOrders,
      estimatedOrders,
      feePolicy,
    });
    return undefined;
  }
  return estimatedOrders;
}
function recordTesterEstimatedTooSmallSkip({
  executionLogWriter,
  requestedScenario,
  effectiveScenario,
  rawOrders,
  estimatedOrders,
  feePolicy,
}: {
  executionLogWriter: ExecutionLogWriter;
  requestedScenario: TesterScenarioSelection;
  effectiveScenario: TesterScenario;
  rawOrders: PlannedRawOrder[];
  estimatedOrders: EstimatedRawOrder[];
  feePolicy: TesterFeePolicy;
}): void {
  executionLogWriter.record({
    skip: testerEstimatedTooSmallSkip(
      requestedScenario,
      effectiveScenario,
      rawOrders,
      estimatedOrders,
      feePolicy,
    ),
  });
}
function skipUnfundedAutoScenario({
  executionLog,
  executionLogWriter,
  totalEquivalentCkb,
  depositCapacity,
}: CapitalSkipOptions): PlannedTesterAttempt | undefined {
  if (totalEquivalentCkb < depositCapacity / MIN_TOTAL_CAPITAL_DIVISOR) {
    stopForLowTesterCapital(executionLog);
    return undefined;
  }
  executionLogWriter.record({ skip: testerNoActionableAutoScenarioSkip() });
  return undefined;
}
function skipEmptyRawOrders({
  executionLog,
  executionLogWriter,
  totalEquivalentCkb,
  depositCapacity,
}: CapitalSkipOptions): PlannedTesterAttempt | undefined {
  if (totalEquivalentCkb < depositCapacity / MIN_TOTAL_CAPITAL_DIVISOR) {
    stopForLowTesterCapital(executionLog);
    return undefined;
  }
  executionLogWriter.record({ skip: { reason: "sampled-amount-too-small" } });
  return undefined;
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
