import {
  appendSupervisorEvent,
  writeCommandArtifacts,
  writeIncident,
  writeSummary,
} from "../../artifacts/supervisorArtifacts.ts";
import { classifyActorResult } from "../../classification/supervisorClassification.ts";
import { testerEvidenceExpectation } from "../../preflight/supervisorPreflightState.ts";
import {
  commandTimeoutOrStop,
  stepLabel,
} from "../../preflight/supervisorPreflightStep.ts";
import {
  SCENARIO_STEPS,
  STOP_EXIT_CODE,
  TESTER_FRESH_ORDER_SKIP,
  TESTER_FRESH_SKIP_TWO_PASS_SCENARIO,
  TESTER_ORDER_CREATED,
  TX_HASH_PATTERN,
  type ScenarioName,
} from "../shared/supervisorConstants.ts";
import { parseJsonEvidence, recordField } from "../shared/supervisorEvidence.ts";
import type {
  Classification,
  CommandResult,
  ParsedArgs,
  ScenarioStep,
  SupervisorDependencies,
  SupervisorPlan,
  SupervisorRunState,
} from "../shared/supervisorTypes.ts";
import { runActor } from "./supervisorActorCommand.ts";
import { recordActorClassification } from "./supervisorActorState.ts";

type FreshSkipProvenance =
  { kind: "pass1" } | { expectedTxHash: string | undefined; kind: "pass2" };

interface ClassifiedActorStep {
  classification: Classification;
  ownedTxHash?: string;
}

/**
 * Runs all actor steps for a chosen scenario.
 *
 * @returns `undefined` when the supervisor should continue, or a final process
 * exit code after a terminal actor path has written required artifacts.
 */
export async function runActorSteps(
  ...[
    cycleIndex,
    scenario,
    args,
    plan,
    state,
    stopForUnavailableWallClockBudget,
    wallClockDeadline,
    dependencies,
  ]: [
    cycleIndex: number,
    scenario: ScenarioName,
    args: ParsedArgs,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    stopForUnavailableWallClockBudget: (
      incidentCycleIndex: number,
      stage: string,
    ) => Promise<number | undefined>,
    wallClockDeadline: number | undefined,
    dependencies: SupervisorDependencies,
  ]
): Promise<number | undefined> {
  let ownedTxHash: string | undefined;
  for (const [stepIndex, step] of SCENARIO_STEPS[scenario].entries()) {
    let provenance: FreshSkipProvenance | undefined;
    if (scenario === TESTER_FRESH_SKIP_TWO_PASS_SCENARIO) {
      provenance =
        stepIndex === 0
          ? { kind: "pass1" }
          : { expectedTxHash: ownedTxHash, kind: "pass2" };
    }
    const result = await runActorStep(
      cycleIndex,
      scenario,
      args,
      step,
      plan,
      state,
      stopForUnavailableWallClockBudget,
      wallClockDeadline,
      provenance,
      dependencies,
    );
    if (typeof result === "number") {
      return result;
    }
    if (scenario === TESTER_FRESH_SKIP_TWO_PASS_SCENARIO && stepIndex === 0) {
      ownedTxHash = result.ownedTxHash;
    }
  }
  return undefined;
}

/**
 * Runs one scenario actor, records command artifacts, and classifies the result.
 *
 * @returns The classified non-terminal step, or a final process exit code after
 * a stop path has written required artifacts.
 */
async function runActorStep(
  ...[
    cycleIndex,
    scenario,
    args,
    step,
    plan,
    state,
    stopForUnavailableWallClockBudget,
    wallClockDeadline,
    provenance,
    dependencies,
  ]: [
    cycleIndex: number,
    scenario: ScenarioName,
    args: ParsedArgs,
    step: ScenarioStep,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    stopForUnavailableWallClockBudget: (
      incidentCycleIndex: number,
      stage: string,
    ) => Promise<number | undefined>,
    wallClockDeadline: number | undefined,
    provenance: FreshSkipProvenance | undefined,
    dependencies: SupervisorDependencies,
  ]
): Promise<ClassifiedActorStep | number> {
  const actorTimeout = await commandTimeoutOrStop(
    plan,
    wallClockDeadline,
    dependencies,
    cycleIndex,
    "actor_start",
    stopForUnavailableWallClockBudget,
  );
  if ("stop" in actorTimeout) {
    return actorTimeout.stop;
  }
  const result = await runActorCommandAndRecordArtifacts(
    cycleIndex,
    step,
    plan,
    state,
    actorTimeout.timeoutMs,
    provenance,
    dependencies,
  );
  const run = await classifyAndRecordActorStep(
    cycleIndex,
    step,
    plan,
    state,
    result,
    provenance,
  );

  if (run.classification.terminal) {
    return stopForTerminalActor(
      cycleIndex,
      scenario,
      step,
      plan,
      state,
      run.classification,
      result,
    );
  }
  if (
    args.stopAfterTxCount !== undefined &&
    state.pendingBotBalanceAudit === undefined &&
    state.txCount >= args.stopAfterTxCount
  ) {
    return stopAfterTxCount(plan, state);
  }
  return run;
}

async function runActorCommandAndRecordArtifacts(
  ...[cycleIndex, step, plan, state, timeoutMs, provenance, dependencies]: [
    cycleIndex: number,
    step: ScenarioStep,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    timeoutMs: number,
    provenance: FreshSkipProvenance | undefined,
    dependencies: SupervisorDependencies,
  ]
): Promise<CommandResult> {
  const result = await runActor(
    step,
    plan,
    timeoutMs,
    provenance?.kind === "pass2" ? provenance.expectedTxHash : undefined,
    dependencies,
  );
  state.artifacts.push(
    ...(await writeCommandArtifacts(plan, cycleIndex, stepLabel(step), result)),
  );
  return result;
}

async function classifyAndRecordActorStep(
  ...[cycleIndex, step, plan, state, result, provenance]: [
    cycleIndex: number,
    step: ScenarioStep,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    result: CommandResult,
    provenance: FreshSkipProvenance | undefined,
  ]
): Promise<ClassifiedActorStep> {
  const classified = classifyActorResult(
    step.actor,
    result,
    step.actor === "tester" ? testerEvidenceExpectation(plan, step) : undefined,
  );
  const classifiedStep =
    provenance?.kind === "pass1"
      ? enforceFreshSkipPass1Provenance(classified, result)
      : { classification: correlateFreshSkipProvenance(classified, provenance) };
  const recordedClassification = recordActorClassification(
    state,
    classifiedStep.classification,
  );
  await appendClassificationEvent(plan, cycleIndex, step, recordedClassification);
  return { ...classifiedStep, classification: recordedClassification };
}

function enforceFreshSkipPass1Provenance(
  classification: Classification,
  result: CommandResult,
): ClassifiedActorStep {
  const txHash = freshSkipPass1TxHash(classification, result);
  return txHash === undefined
    ? {
        classification: {
          ...classification,
          outcome: "malformed_evidence",
          terminal: true,
          reason:
            "tester fresh-skip pass 1 did not produce exactly one valid order transaction hash",
        },
      }
    : {
        classification: { ...classification, txHashes: [txHash] },
        ownedTxHash: txHash,
      };
}

function freshSkipPass1TxHash(
  classification: Classification,
  result: CommandResult,
): string | undefined {
  const classifiedTxHash = classification.txHashes[0]?.toLowerCase();
  const resultTxHashes = structuredResultTxHashes(result);
  return classification.outcome === TESTER_ORDER_CREATED &&
    classification.txHashes.length === 1 &&
    resultTxHashes?.length === 1 &&
    classifiedTxHash === resultTxHashes[0]
    ? classifiedTxHash
    : undefined;
}

function structuredResultTxHashes(result: CommandResult): string[] | undefined {
  const hashes = new Set<string>();
  for (const record of parseJsonEvidence(result.stdout).records) {
    for (const container of [
      record,
      recordField(record, "error"),
      recordField(record, "skip"),
    ]) {
      if (container === undefined || !("txHash" in container)) {
        continue;
      }
      const txHash = container["txHash"];
      if (typeof txHash !== "string" || !TX_HASH_PATTERN.test(txHash)) {
        return undefined;
      }
      hashes.add(txHash.toLowerCase());
    }
  }
  return [...hashes];
}

function correlateFreshSkipProvenance(
  classification: Classification,
  provenance: FreshSkipProvenance | undefined,
): Classification {
  if (
    provenance?.kind !== "pass2" ||
    classification.outcome !== TESTER_FRESH_ORDER_SKIP ||
    (provenance.expectedTxHash !== undefined &&
      classification.txHashes.length === 1 &&
      classification.txHashes[0]?.toLowerCase() === provenance.expectedTxHash)
  ) {
    return classification;
  }
  return {
    ...classification,
    outcome: "malformed_evidence",
    terminal: true,
    reason: "tester fresh-order skip did not match supervisor-owned provenance",
  };
}

async function stopForTerminalActor(
  ...[cycleIndex, scenario, step, plan, state, classification, result]: [
    cycleIndex: number,
    scenario: ScenarioName,
    step: ScenarioStep,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    classification: Classification,
    result: CommandResult,
  ]
): Promise<number> {
  const incident = await writeIncident(
    plan,
    cycleIndex,
    step.actor,
    scenario,
    classification,
    result,
    state.artifacts,
  );
  await writeSummary(plan, state, incident.classification.outcome);
  return classification.outcome === "nonzero_exit" ? 1 : STOP_EXIT_CODE;
}

async function stopAfterTxCount(
  plan: SupervisorPlan,
  state: SupervisorRunState,
): Promise<number> {
  await writeSummary(plan, state, "stop_after_tx_count");
  return 0;
}

async function appendClassificationEvent(
  ...[plan, cycleIndex, step, classification]: [
    plan: SupervisorPlan,
    cycleIndex: number,
    step: ScenarioStep,
    classification: Classification,
  ]
): Promise<void> {
  await appendSupervisorEvent(plan, {
    type: "actor.classified",
    cycleIndex,
    actor: step.actor,
    step: stepLabel(step),
    outcome: classification.outcome,
    terminal: classification.terminal,
    reason: classification.reason,
    txHashes: classification.txHashes,
  });
}
