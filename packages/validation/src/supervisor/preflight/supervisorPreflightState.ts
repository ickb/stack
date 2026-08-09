import {
  BOT_MATCH_COMMITTED,
  BOT_MATCH_PLUS_DEPOSIT_COMMITTED,
  RANDOM_ORDER_SCENARIO,
  SDK_CONVERSION_SCENARIO,
  TESTER_CONVERSION_CREATED,
  TESTER_FRESH_ORDER_SKIP,
  TESTER_ORDER_CREATED,
  type OutcomeKind,
  type TesterScenarioSelection,
} from "../runtime/shared/supervisorConstants.ts";
import {
  optionalRecordField,
  optionalStringField,
  stringField,
} from "../runtime/shared/supervisorEvidence.ts";
import type {
  PreflightCkbBalanceSummary,
  PreflightStateSummary,
  ScenarioStep,
  SupervisorPlan,
  TesterEvidenceExpectation,
} from "../runtime/shared/supervisorTypes.ts";
import { stepLabel } from "./supervisorPreflightStep.ts";

export function testerEvidenceExpectation(
  plan: SupervisorPlan,
  targetOutcomes: OutcomeKind[],
  step: ScenarioStep,
): TesterEvidenceExpectation | undefined {
  const scenario = testerScenarioForTargets(plan.testerScenario, targetOutcomes, step);
  return scenario !== "auto" ? { scenario } : undefined;
}

export function preflightStateSummary(
  ...[cycleIndex, step, plan, targetOutcomes, preflightReport]: [
    cycleIndex: number,
    step: ScenarioStep,
    plan: SupervisorPlan,
    targetOutcomes: OutcomeKind[],
    preflightReport: Record<string, unknown>,
  ]
): PreflightStateSummary {
  const summary: PreflightStateSummary = {
    cycleIndex,
    actor: step.actor,
    step: stepLabel(step),
  };
  const ckbBalance = preflightCkbBalanceSummary(preflightReport);
  const ickbBalance = preflightIckbBalanceSummary(preflightReport);
  if (ckbBalance !== undefined || ickbBalance !== undefined) {
    summary.balances = {
      ...(ckbBalance === undefined ? {} : { CKB: ckbBalance }),
      ...(ickbBalance === undefined ? {} : { ICKB: ickbBalance }),
    };
  }
  if (step.actor === "tester") {
    const selectedTesterScenario = testerScenarioForTargets(
      plan.testerScenario,
      targetOutcomes,
      step,
    );
    summary.selectedTesterScenario = selectedTesterScenario;
  }
  return summary;
}

export function testerScenarioForTargets(
  configuredScenario: TesterScenarioSelection | undefined,
  targetOutcomes: OutcomeKind[],
  step: ScenarioStep,
): TesterScenarioSelection {
  if (configuredScenario !== undefined) {
    return configuredScenario;
  }
  const stepScenario = step.testerScenario;
  if (stepScenario !== undefined) {
    return stepScenario;
  }
  if (targetOutcomes.includes(TESTER_CONVERSION_CREATED)) {
    return SDK_CONVERSION_SCENARIO;
  }
  if (
    targetOutcomes.includes(TESTER_ORDER_CREATED) ||
    targetOutcomes.includes(TESTER_FRESH_ORDER_SKIP) ||
    targetOutcomes.includes(BOT_MATCH_COMMITTED) ||
    targetOutcomes.includes(BOT_MATCH_PLUS_DEPOSIT_COMMITTED)
  ) {
    return RANDOM_ORDER_SCENARIO;
  }
  return "auto";
}

function preflightIckbBalanceSummary(
  preflightReport: Record<string, unknown>,
): NonNullable<PreflightStateSummary["balances"]>["ICKB"] {
  const balances = optionalRecordField(preflightReport, "balances");
  const ickb = optionalRecordField(balances, "ICKB");
  const available = stringField(ickb, "available");
  if (available === undefined) {
    return undefined;
  }
  return {
    available,
    ...optionalStringField(ickb, "unavailable"),
    ...optionalStringField(ickb, "total"),
  };
}

function preflightCkbBalanceSummary(
  preflightReport: Record<string, unknown>,
): PreflightCkbBalanceSummary {
  const balances = optionalRecordField(preflightReport, "balances");
  const ckb = optionalRecordField(balances, "CKB");
  const available = stringField(ckb, "available");
  if (available === undefined) {
    return undefined;
  }
  return {
    available,
    ...optionalStringField(ckb, "plainAvailable"),
    ...optionalStringField(ckb, "projectedAvailable"),
    ...optionalStringField(ckb, "spendable"),
  };
}
