import {
  BOT_MATCH_COMMITTED,
  BOT_RECEIPT_COMPLETION_COMMITTED,
  BOT_WITHDRAWAL_COMPLETION_COMMITTED,
  BOT_WITHDRAWAL_REQUEST_COMMITTED,
  DEFAULT_COVERAGE_GOALS,
  SCENARIOS,
  TESTER_FRESH_ORDER_SKIP,
  TESTER_FRESH_SKIP_TWO_PASS_SCENARIO,
  TX_CREATING_OUTCOMES,
  type OutcomeKind,
  type ScenarioName,
} from "./supervisorConstants.ts";
import type {
  Classification,
  CoverageLedger,
  ParsedArgs,
  ScenarioChoiceResult,
  ScenarioDefinition,
  UnsupportedScenarioChoice,
} from "./supervisorTypes.ts";

/**
 * Creates the mutable coverage ledger used across supervisor cycles.
 */
export function createCoverageLedger(
  goals: OutcomeKind[] = DEFAULT_COVERAGE_GOALS,
): CoverageLedger {
  const counts = emptyOutcomeCounts();
  return {
    goals,
    counts,
    attempts: [],
    unsupported: [],
  };
}

function emptyOutcomeCounts(): Record<OutcomeKind, number> {
  return {
    bot_deposit_only_committed: 0,
    bot_match_committed: 0,
    bot_match_plus_deposit_committed: 0,
    bot_no_action_skip: 0,
    bot_receipt_completion_committed: 0,
    bot_reserve_skip: 0,
    bot_retryable_error: 0,
    bot_terminal_error: 0,
    bot_withdrawal_completion_committed: 0,
    bot_withdrawal_request_committed: 0,
    command_timeout: 0,
    confirmation_timeout: 0,
    economic_loss: 0,
    low_capital_stop: 0,
    malformed_evidence: 0,
    nonzero_exit: 0,
    post_broadcast_unresolved: 0,
    preflight_retryable_error: 0,
    terminal_chain_rejection: 0,
    tester_conversion_created: 0,
    tester_deterministic_pre_broadcast_error: 0,
    tester_dust_order_created: 0,
    tester_estimated_too_small_skip: 0,
    tester_fresh_order_skip: 0,
    tester_order_created: 0,
    tester_reserve_skip: 0,
    tester_retryable_error: 0,
    tester_sampled_too_small_skip: 0,
    unknown: 0,
    unmet_coverage_goal: 0,
    unsupported_scenario: 0,
    wrong_chain: 0,
  };
}

/**
 * Selects the next safe scenario for the requested coverage goals.
 *
 * @remarks Auto mode targets uncovered outcomes first; explicit scenarios reject goals outside their declared safe target set.
 */
export function chooseScenario(
  args: Pick<ParsedArgs, "scenario" | "targetOutcomes">,
  ledger: CoverageLedger,
): ScenarioChoiceResult {
  const explicitGoals = explicitCoverageGoals(args);
  if (args.scenario !== "auto") {
    return chooseExplicitScenario(args.scenario, explicitGoals, ledger);
  }

  return chooseAutoScenario(explicitGoals, ledger);
}

function chooseExplicitScenario(
  scenarioName: Exclude<ScenarioName, "auto">,
  explicitGoals: OutcomeKind[],
  ledger: CoverageLedger,
): ScenarioChoiceResult {
  const explicit = scenarioByName(scenarioName);
  const requestedGoals =
    explicitGoals.length > 0 ? explicitGoals : explicit.targetOutcomes;
  const underCovered =
    requestedGoals.find((outcome) => ledger.counts[outcome] === 0) ?? requestedGoals[0];
  if (underCovered === undefined) {
    throw new Error(`Scenario ${explicit.name} has no target outcomes configured`);
  }
  if (!explicit.targetOutcomes.includes(underCovered)) {
    return {
      kind: "unsupported",
      requested: underCovered,
      reason: `scenario ${explicit.name} does not safely target ${underCovered}`,
    };
  }
  return {
    kind: "scenario",
    scenario: explicit,
    targetOutcomes: [underCovered],
    reason: `explicit scenario ${explicit.name} selected for ${underCovered}`,
  };
}

function chooseAutoScenario(
  explicitGoals: OutcomeKind[],
  ledger: CoverageLedger,
): ScenarioChoiceResult {
  const requestedGoals = explicitGoals.length > 0 ? explicitGoals : ledger.goals;
  const underCovered = nextUncoveredGoal(requestedGoals, ledger);
  if (underCovered === undefined) {
    const defaultScenario = SCENARIOS[0];
    if (defaultScenario === undefined) {
      throw new Error("No supervisor scenarios configured");
    }
    return {
      kind: "scenario",
      scenario: defaultScenario,
      targetOutcomes: defaultScenario.targetOutcomes,
      reason: "default standard cycle because no target outcomes were configured",
    };
  }

  const candidates = SCENARIOS.filter((scenario) =>
    scenario.targetOutcomes.includes(underCovered),
  ).toSorted((left, right) => left.steps.length - right.steps.length);
  const preferred =
    underCovered === TESTER_FRESH_ORDER_SKIP
      ? candidates.find(
          (candidate) => candidate.name === TESTER_FRESH_SKIP_TWO_PASS_SCENARIO,
        )
      : undefined;
  const scenario =
    preferred ??
    candidates.find((candidate) =>
      ledger.attempts.every((attempt) => attempt.scenario !== candidate.name),
    ) ??
    candidates[0];
  if (scenario === undefined) {
    return {
      kind: "unsupported",
      requested: underCovered,
      reason: `${underCovered} is not reachable through safe supervisor/test-harness controls`,
    };
  }
  return {
    kind: "scenario",
    scenario,
    targetOutcomes: [underCovered],
    reason: `selected under-covered safe outcome ${underCovered}`,
  };
}

function nextUncoveredGoal(
  requestedGoals: OutcomeKind[],
  ledger: CoverageLedger,
): OutcomeKind | undefined {
  const uncovered = requestedGoals.filter((outcome) => ledger.counts[outcome] === 0);
  return (
    uncovered.find((outcome) =>
      ledger.attempts.every((attempt) => !attempt.targetOutcomes.includes(outcome)),
    ) ??
    uncovered[0] ??
    requestedGoals[0]
  );
}

/**
 * Records the supervisor scenario choice that was attempted for one cycle.
 */
export function recordScenarioAttempt(
  ledger: CoverageLedger,
  cycleIndex: number,
  choice: ScenarioChoiceResult,
): void {
  if (choice.kind === "unsupported") {
    ledger.unsupported.push({
      cycleIndex,
      requested: choice.requested,
      reason: choice.reason,
    });
    return;
  }
  ledger.attempts.push({
    cycleIndex,
    scenario: choice.scenario.name,
    targetOutcomes: choice.targetOutcomes,
    reason: choice.reason,
  });
}

/** Records the classified outcome and any implied bot action outcomes. */
export function recordClassificationCoverage(
  ledger: CoverageLedger,
  classification: Classification,
): void {
  recordOutcome(ledger, classification.outcome);
  if (
    classification.actor !== "bot" ||
    classification.terminal ||
    !TX_CREATING_OUTCOMES.has(classification.outcome)
  ) {
    return;
  }
  const actions = classification.actions;
  if (actions === undefined) {
    return;
  }
  const impliedOutcomes: Array<[OutcomeKind, number]> = [
    [BOT_MATCH_COMMITTED, actions.matchedOrders],
    [BOT_WITHDRAWAL_REQUEST_COMMITTED, actions.withdrawalRequests],
    [BOT_RECEIPT_COMPLETION_COMMITTED, actions.completedDeposits],
    [BOT_WITHDRAWAL_COMPLETION_COMMITTED, actions.withdrawals],
  ];
  for (const [outcome, count] of impliedOutcomes) {
    if (classification.outcome !== outcome && count > 0) {
      recordOutcome(ledger, outcome);
    }
  }
}

function recordOutcome(ledger: CoverageLedger, outcome: OutcomeKind): void {
  Object.assign(ledger.counts, { [outcome]: ledger.counts[outcome] + 1 });
}

export function unsupportedClassification(
  choice: UnsupportedScenarioChoice,
): Classification {
  return {
    actor: "preflight",
    outcome: "unsupported_scenario",
    terminal: true,
    reason: choice.reason,
    txHashes: [],
    evidence: {
      recordsAccepted: 0,
      ignoredLineCount: 0,
      malformedLineCount: 0,
      exitStatus: null,
      signal: null,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    },
  };
}

export function unmetExplicitGoals(
  args: Pick<ParsedArgs, "targetOutcomes">,
  ledger: CoverageLedger,
): OutcomeKind[] {
  return explicitCoverageGoals(args).filter((outcome) => ledger.counts[outcome] === 0);
}

export function explicitCoverageGoals(
  args: Pick<ParsedArgs, "targetOutcomes">,
): OutcomeKind[] {
  return [...new Set(args.targetOutcomes)];
}

export function scenarioByName(name: Exclude<ScenarioName, "auto">): ScenarioDefinition {
  const scenario = SCENARIOS.find((candidate) => candidate.name === name);
  if (scenario === undefined) {
    throw new Error(`Unknown scenario: ${name}`);
  }
  return scenario;
}
