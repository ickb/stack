import type { TesterScenarioSelection } from "../runtime/shared/supervisorConstants.ts";
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

/** The operator's `--tester-scenario` wins over the scenario step's own choice. */
export function testerScenarioFor(
  plan: SupervisorPlan,
  step: ScenarioStep,
): TesterScenarioSelection {
  return plan.testerScenario ?? step.testerScenario ?? "auto";
}

export function testerEvidenceExpectation(
  plan: SupervisorPlan,
  step: ScenarioStep,
): TesterEvidenceExpectation | undefined {
  const scenario = testerScenarioFor(plan, step);
  return scenario === "auto" ? undefined : { scenario };
}

export function preflightStateSummary(
  cycleIndex: number,
  step: ScenarioStep,
  plan: SupervisorPlan,
  preflightReport: Record<string, unknown>,
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
    summary.selectedTesterScenario = testerScenarioFor(plan, step);
  }
  return summary;
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
