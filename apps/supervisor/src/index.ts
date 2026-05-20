import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const DEFAULT_COMMAND_TIMEOUT_SECONDS = 15 * 60;
const DEFAULT_COMMAND_KILL_GRACE_MS = 5 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_BOT_CONFIG_PATH = "config/bot-testnet.json";
const DEFAULT_TESTER_CONFIG_PATH = "config/tester-testnet.json";
const STOP_EXIT_CODE = 2;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const SUPERVISOR_OUTPUT_ROOT = "logs/live-supervisor/";

export const OUTCOME_KINDS = [
  "tester_order_created",
  "tester_conversion_created",
  "tester_fresh_order_skip",
  "tester_sampled_too_small_skip",
  "tester_estimated_too_small_skip",
  "tester_reserve_skip",
  "tester_deterministic_pre_broadcast_error",
  "bot_no_action_skip",
  "bot_reserve_skip",
  "bot_match_committed",
  "bot_match_plus_deposit_committed",
  "bot_receipt_completion_committed",
  "bot_deposit_only_committed",
  "bot_withdrawal_request_committed",
  "bot_withdrawal_completion_committed",
  "low_capital_stop",
  "confirmation_timeout",
  "terminal_chain_rejection",
  "post_broadcast_unresolved",
  "wrong_chain",
  "malformed_evidence",
  "secret_leak_sentinel",
  "command_timeout",
  "nonzero_exit",
  "unmet_coverage_goal",
  "unknown",
] as const;

export type OutcomeKind = typeof OUTCOME_KINDS[number];
export type Actor = "bot" | "tester";
export type ScenarioName = "auto" | "standard-cycle" | "tester-only" | "bot-only" | "tester-fresh-skip-two-pass";
export type TesterScenario = "auto" | "random-order" | "sdk-conversion" | "extra-large-limit-order" | "multi-order-limit-orders" | "two-ckb-to-ickb-limit-orders" | "all-ckb-limit-order" | "all-ickb-limit-order" | "ickb-to-ckb-limit-order" | "two-ickb-to-ckb-limit-orders" | "mixed-direction-limit-orders" | "dust-ckb-conversion" | "dust-ickb-conversion";
type TesterDirection = "ckb-to-ickb" | "ickb-to-ckb";

interface ScenarioStep {
  actor: Actor;
  label?: string;
  testerScenario?: TesterScenario;
}

interface ScenarioDefinition {
  name: Exclude<ScenarioName, "auto">;
  steps: ScenarioStep[];
  targetOutcomes: OutcomeKind[];
  reason: string;
}

export interface ParsedArgs {
  help: boolean;
  dryRun: boolean;
  botConfigPath?: string;
  testerConfigPath?: string;
  outDir?: string;
  maxCycles: number;
  maxWallClockSeconds?: number;
  stopAfterTxCount?: number;
  scenario: ScenarioName;
  targetOutcomes: OutcomeKind[];
  testerScenario: TesterScenario;
  testerScenarioExplicit: boolean;
  testerFee: string;
  testerFeeBase: string;
  testerFeeExplicit: boolean;
  testerFeeBaseExplicit: boolean;
  commandTimeoutSeconds: number;
}

export interface SupervisorPlan extends ParsedArgs {
  runId: string;
  rootDir: string;
  botConfigPath?: string;
  testerConfigPath?: string;
  outDir: string;
  relativeOutDir: string;
}

export interface CommandResult {
  actor: Actor | "preflight";
  command: string;
  args: string[];
  spawnError?: string;
  status: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  elapsedMs: number;
}

export interface ParsedEvidence {
  records: Record<string, unknown>[];
  ignoredLines: string[];
  malformedLines: string[];
}

export interface Classification {
  actor: Actor | "preflight";
  outcome: OutcomeKind;
  terminal: boolean;
  reason: string;
  txHashes: string[];
  evidence: {
    recordsAccepted: number;
    ignoredLineCount: number;
    malformedLineCount: number;
    exitStatus: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
  };
  actions?: ActionCounts;
  skipReason?: string;
  publicState?: PublicStateAssumption;
}

interface TesterEvidenceExpectation {
  scenario: TesterScenario;
}

export interface ActionCounts {
  collectedOrders: number;
  completedDeposits: number;
  matchedOrders: number;
  deposits: number;
  withdrawalRequests: number;
  withdrawals: number;
}

export interface PublicStateAssumption {
  marketOrderCount?: number;
  userOrderCount?: number;
  receiptCount?: number;
  readyPoolDepositCount?: number;
  nearReadyPoolDepositCount?: number;
  futurePoolDepositCount?: number;
}

export interface CoverageLedger {
  goals: OutcomeKind[];
  counts: Record<OutcomeKind, number>;
  attempts: Array<{
    cycleIndex: number;
    scenario: Exclude<ScenarioName, "auto">;
    targetOutcomes: OutcomeKind[];
    reason: string;
  }>;
  unsupported: Array<{
    cycleIndex: number;
    requested: OutcomeKind;
    reason: string;
  }>;
}

export interface ScenarioChoice {
  kind: "scenario";
  scenario: ScenarioDefinition;
  targetOutcomes: OutcomeKind[];
  reason: string;
}

export interface UnsupportedScenarioChoice {
  kind: "unsupported";
  requested: OutcomeKind;
  reason: string;
}

type ScenarioChoiceResult = ScenarioChoice | UnsupportedScenarioChoice;

interface Dependencies {
  spawnCommand?: typeof spawn;
  spawnSyncCommand?: typeof spawnSync;
  now?: () => number;
  writeFile?: typeof writeFile;
  appendFile?: typeof appendFile;
  mkdir?: typeof mkdir;
  lstat?: typeof lstat;
  realpath?: typeof realpath;
  stat?: typeof stat;
  existsSync?: typeof existsSync;
  skipBuiltRuntimeCheck?: boolean;
  maxOutputBytes?: number;
  commandKillGraceMs?: number;
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
}

interface IncidentArtifact {
  relativePath: string;
  classification: Classification;
}

export interface BoundedOutputCapture {
  chunks: Buffer[];
  byteLength: number;
  truncatedBytes: number;
}

const SCENARIOS: ScenarioDefinition[] = [
  {
    name: "standard-cycle",
    steps: [{ actor: "tester" }, { actor: "bot" }],
    targetOutcomes: [
      "tester_order_created",
      "tester_conversion_created",
      "tester_fresh_order_skip",
      "tester_sampled_too_small_skip",
      "tester_estimated_too_small_skip",
      "bot_no_action_skip",
      "bot_match_committed",
      "bot_match_plus_deposit_committed",
      "bot_receipt_completion_committed",
      "bot_deposit_only_committed",
      "bot_withdrawal_request_committed",
      "bot_withdrawal_completion_committed",
    ],
    reason: "run tester then bot so new and existing public state can exercise bot branches",
  },
  {
    name: "tester-only",
    steps: [{ actor: "tester" }],
    targetOutcomes: [
      "tester_order_created",
      "tester_conversion_created",
      "tester_fresh_order_skip",
      "tester_sampled_too_small_skip",
      "tester_estimated_too_small_skip",
    ],
    reason: "focus on tester order creation and skip branches without adding an immediate bot mutation",
  },
  {
    name: "bot-only",
    steps: [{ actor: "bot" }],
    targetOutcomes: [
      "bot_no_action_skip",
      "bot_match_committed",
      "bot_match_plus_deposit_committed",
      "bot_receipt_completion_committed",
      "bot_deposit_only_committed",
      "bot_withdrawal_request_committed",
      "bot_withdrawal_completion_committed",
    ],
    reason: "focus on bot behavior against current public iCKB pool and order state",
  },
  {
    name: "tester-fresh-skip-two-pass",
    steps: [
      { actor: "tester", label: "tester-pass-1", testerScenario: "multi-order-limit-orders" },
      { actor: "tester", label: "tester-pass-2" },
    ],
    targetOutcomes: [
      "tester_order_created",
      "tester_fresh_order_skip",
    ],
    reason: "run the same tester twice so a multi-order first pass can leave a fresh owned order for skip coverage",
  },
];

const DEFAULT_COVERAGE_GOALS: OutcomeKind[] = [
  "tester_order_created",
  "tester_fresh_order_skip",
  "tester_sampled_too_small_skip",
  "bot_no_action_skip",
  "bot_match_committed",
  "bot_match_plus_deposit_committed",
  "bot_receipt_completion_committed",
  "bot_deposit_only_committed",
  "bot_withdrawal_request_committed",
  "bot_withdrawal_completion_committed",
];

const OUTCOME_SET = new Set<OutcomeKind>(OUTCOME_KINDS);
export const TX_CREATING_OUTCOMES: ReadonlySet<OutcomeKind> = new Set<OutcomeKind>([
  "tester_order_created",
  "tester_conversion_created",
  "bot_match_committed",
  "bot_match_plus_deposit_committed",
  "bot_receipt_completion_committed",
  "bot_deposit_only_committed",
  "bot_withdrawal_request_committed",
  "bot_withdrawal_completion_committed",
  "confirmation_timeout",
  "terminal_chain_rejection",
  "post_broadcast_unresolved",
]);

export function usage(): string {
  return [
    "Usage: node apps/supervisor/dist/index.js [options]",
    "Options:",
    `  --bot-config <ignored-json-config>     Default: ${DEFAULT_BOT_CONFIG_PATH}`,
    `  --tester-config <ignored-json-config>  Default: ${DEFAULT_TESTER_CONFIG_PATH}`,
    "  --out-dir <ignored-dir>              Default: logs/live-supervisor/<run-id>",
    "  --max-cycles <n>                    Default: 1",
    "  --max-wall-clock-seconds <n>",
    "  --stop-after-tx-count <n>",
    "  --scenario auto|standard-cycle|tester-only|bot-only|tester-fresh-skip-two-pass",
    "  --tester-scenario auto|random-order|sdk-conversion|extra-large-limit-order|multi-order-limit-orders|two-ckb-to-ickb-limit-orders|all-ckb-limit-order|all-ickb-limit-order|ickb-to-ckb-limit-order|two-ickb-to-ckb-limit-orders|mixed-direction-limit-orders|dust-ckb-conversion|dust-ickb-conversion",
    "  --tester-fee <n>                    Default: 1",
    "  --tester-fee-base <n>               Default: 100000",
    "  --target-outcome <outcome>           Repeatable; planner prefers these first",
    "  --command-timeout-seconds <n>        Default: 900",
    "  --dry-run                           Fixture-only run; no live configs required",
    "  -h, --help",
  ].join("\n");
}

export function parseArgs(argv: string[]): ParsedArgs {
    const args: ParsedArgs = {
      help: false,
      dryRun: false,
      botConfigPath: DEFAULT_BOT_CONFIG_PATH,
      testerConfigPath: DEFAULT_TESTER_CONFIG_PATH,
      maxCycles: 1,
    scenario: "auto",
    targetOutcomes: [],
    testerScenario: "auto",
    testerScenarioExplicit: false,
    testerFee: "1",
    testerFeeBase: "100000",
    testerFeeExplicit: false,
    testerFeeBaseExplicit: false,
    commandTimeoutSeconds: DEFAULT_COMMAND_TIMEOUT_SECONDS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      throw new Error(`Missing argument at index ${String(index)}`);
    }
    if (arg === "--") {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      args.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--bot-config") {
      args.botConfigPath = valueAfter(argv, ++index, arg);
      continue;
    }
    if (arg === "--tester-config") {
      args.testerConfigPath = valueAfter(argv, ++index, arg);
      continue;
    }
    if (arg === "--out-dir") {
      args.outDir = valueAfter(argv, ++index, arg);
      continue;
    }
    if (arg === "--max-cycles") {
      args.maxCycles = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--max-wall-clock-seconds") {
      args.maxWallClockSeconds = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--stop-after-tx-count") {
      args.stopAfterTxCount = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--scenario") {
      args.scenario = parseScenarioName(valueAfter(argv, ++index, arg));
      continue;
    }
    if (arg === "--target-outcome") {
      args.targetOutcomes.push(parseOutcome(valueAfter(argv, ++index, arg), arg));
      continue;
    }
    if (arg === "--tester-scenario") {
      args.testerScenario = parseTesterScenario(valueAfter(argv, ++index, arg));
      args.testerScenarioExplicit = true;
      continue;
    }
    if (arg === "--tester-fee") {
      args.testerFee = parseTesterFeeValue(valueAfter(argv, ++index, arg), arg);
      args.testerFeeExplicit = true;
      continue;
    }
    if (arg === "--tester-fee-base") {
      args.testerFeeBase = parseTesterFeeValue(valueAfter(argv, ++index, arg), arg);
      args.testerFeeBaseExplicit = true;
      continue;
    }
    if (arg === "--command-timeout-seconds") {
      args.commandTimeoutSeconds = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.help || args.dryRun) {
    args.botConfigPath = undefined;
    args.testerConfigPath = undefined;
  }
  return args;
}

export function resolvePlan(args: ParsedArgs, rootDir = repoRoot, dependencies: Dependencies = {}): SupervisorPlan {
  const runId = createRunId();
  const outDir = insideRepoPath(rootDir, args.outDir ?? `logs/live-supervisor/${runId}`, "Output directory");
  const relativeOutDir = relative(rootDir, outDir);
  const botConfigPath = args.botConfigPath === undefined
    ? undefined
    : insideRepoPath(rootDir, args.botConfigPath, "Bot config path");
  const testerConfigPath = args.testerConfigPath === undefined
    ? undefined
    : insideRepoPath(rootDir, args.testerConfigPath, "Tester config path");
  assertSupervisorOutputDirectory(relativeOutDir);
  if (!isIgnoredPath(rootDir, relativeOutDir, dependencies)) {
    throw new Error(`Refusing to write non-ignored supervisor output directory: ${relativeOutDir}`);
  }
  if (botConfigPath !== undefined) {
    assertIgnoredConfigPath(rootDir, botConfigPath, "Bot config path", dependencies);
  }
  if (testerConfigPath !== undefined) {
    assertIgnoredConfigPath(rootDir, testerConfigPath, "Tester config path", dependencies);
  }

  return {
    ...args,
    runId,
    rootDir,
    botConfigPath,
    testerConfigPath,
    outDir,
    relativeOutDir,
  };
}

export function parseJsonEvidence(stdout: string): ParsedEvidence {
  const records = new Array<Record<string, unknown>>();
  const ignoredLines = new Array<string>();
  const malformedLines = new Array<string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    if (!trimmed.startsWith("{")) {
      ignoredLines.push(trimmed);
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) {
        records.push(parsed);
      } else {
        malformedLines.push(trimmed);
      }
    } catch {
      malformedLines.push(trimmed);
    }
  }
  return { records, ignoredLines, malformedLines };
}

export function parsePreflightEvidence(stdout: string): ParsedEvidence {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    return { records: [], ignoredLines: [], malformedLines: [] };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed)
      ? { records: [parsed], ignoredLines: [], malformedLines: [] }
      : { records: [], ignoredLines: [], malformedLines: [trimmed] };
  } catch {
    return parseJsonEvidence(stdout);
  }
}

export function classifyActorResult(
  actor: Actor | "preflight",
  result: CommandResult,
  expectation?: TesterEvidenceExpectation,
): Classification {
  const evidence = actor === "preflight"
    ? parsePreflightEvidence(result.stdout)
    : parseJsonEvidence(result.stdout);
  const txHashes = extractTxHashes(evidence.records);
  const base = {
    actor,
    txHashes,
    evidence: {
      recordsAccepted: evidence.records.length,
      ignoredLineCount: evidence.ignoredLines.length,
      malformedLineCount: evidence.malformedLines.length,
      exitStatus: result.status,
      signal: result.signal,
      timedOut: result.timedOut,
    },
  };

  if (containsSecretLeak(result.stdout) || containsSecretLeak(result.stderr)) {
    return {
      ...base,
      outcome: "secret_leak_sentinel",
      terminal: true,
      reason: "stdout or stderr contained a secret-shaped field",
    };
  }
  if (result.timedOut) {
    return {
      ...base,
      outcome: "command_timeout",
      terminal: true,
      reason: "supervisor command timeout expired",
    };
  }
  if (result.spawnError !== undefined) {
    return {
      ...base,
      outcome: "nonzero_exit",
      terminal: true,
      reason: `${actor} failed to spawn: ${result.spawnError}`,
    };
  }
  if (evidence.malformedLines.length > 0) {
    return {
      ...base,
      outcome: "malformed_evidence",
      terminal: true,
      reason: "stdout contained malformed JSON evidence",
    };
  }
  if (actor === "preflight") {
    return classifyPreflightResult(result, evidence, base);
  }
  if (actor === "bot") {
    return classifyBotResult(result, evidence, base);
  }
  return classifyTesterResult(result, evidence, base, expectation);
}

export function createCoverageLedger(goals: OutcomeKind[] = DEFAULT_COVERAGE_GOALS): CoverageLedger {
  return {
    goals,
    counts: Object.fromEntries(OUTCOME_KINDS.map((outcome) => [outcome, 0])) as Record<OutcomeKind, number>,
    attempts: [],
    unsupported: [],
  };
}

export function chooseScenario(args: Pick<ParsedArgs, "scenario" | "targetOutcomes">, ledger: CoverageLedger): ScenarioChoiceResult {
  const explicitGoals = explicitCoverageGoals(args);
  if (args.scenario !== "auto") {
    const explicit = scenarioByName(args.scenario);
    const requestedGoals = explicitGoals.length > 0 ? explicitGoals : explicit.targetOutcomes;
    const underCovered = requestedGoals.find((outcome) => ledger.counts[outcome] === 0) ?? requestedGoals[0];
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

  const candidates = SCENARIOS
    .filter((scenario) => scenario.targetOutcomes.includes(underCovered))
    .sort((left, right) => left.steps.length - right.steps.length);
  const scenario = candidates.find((candidate) => !ledger.attempts.some((attempt) => attempt.scenario === candidate.name))
    ?? candidates[0];
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

function nextUncoveredGoal(requestedGoals: OutcomeKind[], ledger: CoverageLedger): OutcomeKind | undefined {
  const uncovered = requestedGoals.filter((outcome) => ledger.counts[outcome] === 0);
  return uncovered.find((outcome) => !ledger.attempts.some((attempt) => attempt.targetOutcomes.includes(outcome)))
    ?? uncovered[0]
    ?? requestedGoals[0];
}

export function recordScenarioAttempt(
  ledger: CoverageLedger,
  cycleIndex: number,
  choice: ScenarioChoiceResult,
): void {
  if (choice.kind === "unsupported") {
    ledger.unsupported.push({ cycleIndex, requested: choice.requested, reason: choice.reason });
    return;
  }
  ledger.attempts.push({
    cycleIndex,
    scenario: choice.scenario.name,
    targetOutcomes: choice.targetOutcomes,
    reason: choice.reason,
  });
}

export function recordOutcome(ledger: CoverageLedger, outcome: OutcomeKind): void {
  ledger.counts[outcome] += 1;
}

export async function supervise(args: ParsedArgs, plan: SupervisorPlan, dependencies: Dependencies = {}): Promise<number> {
  return superviseOnce(args, plan, dependencies);
}

async function superviseOnce(args: ParsedArgs, plan: SupervisorPlan, dependencies: Dependencies = {}): Promise<number> {
  const startedAt = now(dependencies);
  if (!args.dryRun && dependencies.skipBuiltRuntimeCheck !== true) {
    assertBuiltRuntime(plan, dependencies);
  }
  await prepareOutputDirectory(plan, dependencies);
  const ledger = createCoverageLedger(explicitCoverageGoals(args).length > 0 ? explicitCoverageGoals(args) : DEFAULT_COVERAGE_GOALS);
  const classifications = new Array<Classification>();
  const artifacts = new Array<string>();
  let txCount = 0;
  let latestPublicState: PublicStateAssumption | undefined;

  if (args.dryRun) {
    const dryRunResult = await runDryRun(plan, ledger, dependencies);
    return dryRunResult;
  }

  for (let cycleIndex = 1; cycleIndex <= args.maxCycles; cycleIndex += 1) {
    if (args.maxWallClockSeconds !== undefined && now(dependencies) - startedAt >= args.maxWallClockSeconds * 1000) {
      await writeSummary(plan, ledger, classifications, artifacts, latestPublicState, "max_wall_clock_seconds", dependencies);
      return 0;
    }

    const choice = chooseScenario(args, ledger);
    recordScenarioAttempt(ledger, cycleIndex, choice);
    if (choice.kind === "unsupported") {
      const classification = unsupportedClassification(choice);
      classifications.push(classification);
      const incident = unsupportedIncident(plan, cycleIndex, choice, ledger, classification);
      await writeJsonArtifact(plan, `cycle-${padCycle(cycleIndex)}-incident.json`, incident, artifacts, dependencies);
      await writeSummary(plan, ledger, classifications, artifacts, latestPublicState, "unsupported_scenario", dependencies);
      return STOP_EXIT_CODE;
    }

    await appendSupervisorEvent(plan, {
      type: "cycle.started",
      cycleIndex,
      scenario: choice.scenario.name,
      targetOutcomes: choice.targetOutcomes,
      reason: choice.reason,
    }, dependencies);

    for (const step of choice.scenario.steps) {
      const result = await runPreflight(step.actor, plan, cycleIndex, stepLabel(step), dependencies);
      artifacts.push(...await writeCommandArtifacts(plan, cycleIndex, `${stepLabel(step)}-preflight`, result, dependencies));
      const classification = classifyActorResult("preflight", result);
      if (classification.terminal) {
        classifications.push(classification);
        await writeIncident(plan, cycleIndex, step.actor, choice, classification, result, ledger, artifacts, dependencies);
        await writeSummary(plan, ledger, classifications, artifacts, latestPublicState, classification.outcome, dependencies);
        return STOP_EXIT_CODE;
      }
    }

    for (const step of choice.scenario.steps) {
      const result = await runActor(step, plan, choice.targetOutcomes, dependencies);
      artifacts.push(...await writeCommandArtifacts(plan, cycleIndex, stepLabel(step), result, dependencies));
      const classification = classifyActorResult(step.actor, result, step.actor === "tester" ? testerEvidenceExpectation(plan, step) : undefined);
      classifications.push(classification);
      recordOutcome(ledger, classification.outcome);
      txCount += txCreatingHashCount(classification);
      latestPublicState = classification.publicState ?? latestPublicState;
      await appendSupervisorEvent(plan, {
        type: "actor.classified",
        cycleIndex,
        actor: step.actor,
        step: stepLabel(step),
        outcome: classification.outcome,
        terminal: classification.terminal,
        reason: classification.reason,
        txHashes: classification.txHashes,
      }, dependencies);

      if (classification.terminal) {
        const incident = await writeIncident(plan, cycleIndex, step.actor, choice, classification, result, ledger, artifacts, dependencies);
        await writeSummary(plan, ledger, classifications, artifacts, latestPublicState, incident.classification.outcome, dependencies);
        return classification.outcome === "nonzero_exit" ? 1 : STOP_EXIT_CODE;
      }
      if (args.stopAfterTxCount !== undefined && txCount >= args.stopAfterTxCount) {
        await writeSummary(plan, ledger, classifications, artifacts, latestPublicState, "stop_after_tx_count", dependencies);
        return 0;
      }
    }
  }

  const unmetGoals = unmetExplicitGoals(args, ledger);
  if (unmetGoals.length > 0) {
    const incident = await writeUnmetCoverageIncident(plan, args.maxCycles, unmetGoals, ledger, artifacts, dependencies);
    classifications.push(incident.classification);
    await writeSummary(plan, ledger, classifications, artifacts, latestPublicState, incident.classification.outcome, dependencies);
    return STOP_EXIT_CODE;
  }

  await writeSummary(plan, ledger, classifications, artifacts, latestPublicState, "max_cycles", dependencies);
  return 0;
}

export async function main(argv: string[], io: { stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream } = {}): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n${usage()}\n`);
    return 1;
  }
  if (parsed.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const plan = resolvePlan(parsed);
    const exitCode = await supervise(parsed, plan);
    stdout.write(`live supervisor artifacts: ${plan.relativeOutDir}\n`);
    return exitCode;
  } catch (error) {
    stderr.write(`Live supervisor failed: ${errorMessage(error)}\n`);
    return 1;
  }
}

async function runDryRun(plan: SupervisorPlan, ledger: CoverageLedger, dependencies: Dependencies): Promise<number> {
  const artifacts = new Array<string>();
  const classifications = new Array<Classification>();
  const choice = chooseScenario(plan, ledger);
  recordScenarioAttempt(ledger, 1, choice);
  if (choice.kind === "unsupported") {
    const classification = unsupportedClassification(choice);
    classifications.push(classification);
    const incident = unsupportedIncident(plan, 1, choice, ledger, classification);
    await writeJsonArtifact(plan, "dry-run-incident.json", incident, artifacts, dependencies);
    await writeSummary(plan, ledger, classifications, artifacts, undefined, "unsupported_scenario", dependencies);
    return STOP_EXIT_CODE;
  }

  const samples: Array<{ actor: Actor; result: CommandResult }> = [
    {
      actor: "tester",
      result: fixtureResult("tester", JSON.stringify({
        startTime: "dry-run",
        actions: { newOrder: { giveCkb: "100", takeIckb: "99", fee: "0.001" }, cancelledOrders: 0 },
        txHash: sampleTxHash("11"),
        ElapsedSeconds: 1,
      })),
    },
    {
      actor: "bot",
      result: fixtureResult("bot", [
        JSON.stringify(botEvent("bot.state.read", {
          orders: { marketCount: 3, userCount: 0, receiptCount: 1 },
          poolDeposits: { readyCount: 2, nearReadyCount: 1, futureCount: 5 },
        })),
        JSON.stringify(botEvent("bot.decision.skipped", {
          reason: "no_actions",
          actions: emptyActions(),
        })),
      ].join("\n")),
    },
  ];

  let latestPublicState: PublicStateAssumption | undefined;
  for (const sample of samples.filter((item) => scenarioActors(choice.scenario).includes(item.actor))) {
    const classification = classifyActorResult(sample.actor, sample.result);
    classifications.push(classification);
    recordOutcome(ledger, classification.outcome);
    latestPublicState = classification.publicState ?? latestPublicState;
    artifacts.push(...await writeCommandArtifacts(plan, 1, `dry-run-${sample.actor}`, sample.result, dependencies));
  }

  await writeSummary(plan, ledger, classifications, artifacts, latestPublicState, "dry_run", dependencies);
  return 0;
}

async function prepareOutputDirectory(plan: SupervisorPlan, dependencies: Dependencies): Promise<void> {
  const statFn = dependencies.stat ?? stat;
  const mkdirFn = dependencies.mkdir ?? mkdir;
  await assertNoSymlinkedOutputAncestors(plan, dependencies);
  try {
    await statFn(plan.outDir);
    throw new Error(`Output directory already exists: ${plan.relativeOutDir}`);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
  await mkdirFn(plan.outDir, { recursive: true });
  await assertRealOutputDirectory(plan, dependencies);
}

async function assertNoSymlinkedOutputAncestors(plan: SupervisorPlan, dependencies: Dependencies): Promise<void> {
  const lstatFn = dependencies.lstat ?? lstat;
  const parts = plan.relativeOutDir.split("/").filter((part) => part !== "");
  let current = plan.rootDir;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stats = await lstatFn(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing to write supervisor artifacts through symlinked path: ${relative(plan.rootDir, current)}`);
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }
}

async function assertRealOutputDirectory(plan: SupervisorPlan, dependencies: Dependencies): Promise<void> {
  const realpathFn = dependencies.realpath ?? realpath;
  let realRoot: string;
  let realOutDir: string;
  try {
    [realRoot, realOutDir] = await Promise.all([
      realpathFn(plan.rootDir),
      realpathFn(plan.outDir),
    ]);
  } catch (error) {
    if (dependencies.mkdir !== undefined && isNotFoundError(error)) {
      return;
    }
    throw error;
  }
  const relativeOutDir = relative(realRoot, realOutDir);
  if (relativeOutDir.startsWith("..") || isAbsolute(relativeOutDir)) {
    throw new Error("Supervisor output directory must stay inside the repo");
  }
}

function assertBuiltRuntime(plan: SupervisorPlan, dependencies: Dependencies): void {
  const required = [
    ["CCC core", join(plan.rootDir, "forks/ccc/repo/packages/core/dist/index.js")],
    ["CCC UDT", join(plan.rootDir, "forks/ccc/repo/packages/udt/dist/index.js")],
    ["utils package", join(plan.rootDir, "packages/utils/dist/index.js")],
    ["DAO package", join(plan.rootDir, "packages/dao/dist/index.js")],
    ["core package", join(plan.rootDir, "packages/core/dist/index.js")],
    ["order package", join(plan.rootDir, "packages/order/dist/index.js")],
    ["SDK package", join(plan.rootDir, "packages/sdk/dist/index.js")],
    ["node-utils package", join(plan.rootDir, "packages/node-utils/dist/index.js")],
    ["bot app", join(plan.rootDir, "apps/bot/dist/index.js")],
    ["tester app", join(plan.rootDir, "apps/tester/dist/index.js")],
    ["live preflight script", join(plan.rootDir, "scripts/ickb-live-preflight.mjs")],
  ] as const;
  const exists = dependencies.existsSync ?? existsSync;
  for (const [label, path] of required) {
    if (!exists(path)) {
      throw new Error(`Missing built ${label}: ${relative(plan.rootDir, path)}`);
    }
  }
}

async function runPreflight(actor: Actor, plan: SupervisorPlan, cycleIndex: number, role: string, dependencies: Dependencies): Promise<CommandResult> {
  const configPath = actor === "bot" ? plan.botConfigPath : plan.testerConfigPath;
  if (configPath === undefined) {
    throw new Error(`Missing ${actor} config path`);
  }
  await assertNoSymlinkedConfigPath(plan.rootDir, configPath, `${actor} config path`, dependencies);
  return runCommand({
    actor: "preflight",
    command: process.execPath,
    args: ["scripts/ickb-live-preflight.mjs", "--config", configPath, "--role", `${role}-${String(cycleIndex)}`],
    cwd: plan.rootDir,
    env: liveActorEnv({ INIT_CWD: plan.rootDir }),
    inheritEnv: false,
    timeoutMs: plan.commandTimeoutSeconds * 1000,
  }, dependencies);
}

async function runActor(step: ScenarioStep, plan: SupervisorPlan, targetOutcomes: OutcomeKind[], dependencies: Dependencies): Promise<CommandResult> {
  const actor = step.actor;
  const configPath = actor === "bot" ? plan.botConfigPath : plan.testerConfigPath;
  if (configPath === undefined) {
    throw new Error(`Missing ${actor} config path`);
  }
  await assertNoSymlinkedConfigPath(plan.rootDir, configPath, `${actor} config path`, dependencies);
  const entrypoint = actor === "bot" ? "apps/bot/dist/index.js" : "apps/tester/dist/index.js";
  const configEnvName = actor === "bot" ? "BOT_CONFIG_FILE" : "TESTER_CONFIG_FILE";
  return runCommand({
    actor,
    command: process.execPath,
    args: [entrypoint],
    cwd: plan.rootDir,
    env: liveActorEnv({
      [configEnvName]: configPath,
      INIT_CWD: plan.rootDir,
      ...(actor === "tester" ? testerEnv(plan, targetOutcomes, step) : {}),
    }),
    inheritEnv: false,
    timeoutMs: plan.commandTimeoutSeconds * 1000,
  }, dependencies);
}

function testerEnv(plan: SupervisorPlan, targetOutcomes: OutcomeKind[], step: ScenarioStep): Record<string, string> {
  return {
    TESTER_SCENARIO: testerScenarioForTargets(plan.testerScenario, plan.testerScenarioExplicit, targetOutcomes, step.testerScenario),
    ...(plan.testerFeeExplicit ? { TESTER_FEE: plan.testerFee } : {}),
    ...(plan.testerFeeBaseExplicit ? { TESTER_FEE_BASE: plan.testerFeeBase } : {}),
  };
}

function testerEvidenceExpectation(plan: SupervisorPlan, step: ScenarioStep): TesterEvidenceExpectation | undefined {
  const scenario = testerScenarioForTargets(plan.testerScenario, plan.testerScenarioExplicit, [], step.testerScenario);
  return scenario !== "auto" ? { scenario } : undefined;
}

function testerScenarioForTargets(
  configuredScenario: TesterScenario,
  testerScenarioExplicit: boolean,
  targetOutcomes: OutcomeKind[],
  stepScenario: TesterScenario | undefined,
): TesterScenario {
  if (testerScenarioExplicit || configuredScenario !== "auto") {
    return configuredScenario;
  }
  if (stepScenario !== undefined) {
    return stepScenario;
  }
  if (targetOutcomes.includes("tester_conversion_created")) {
    return "sdk-conversion";
  }
  return configuredScenario;
}

function stepLabel(step: ScenarioStep): string {
  return step.label ?? step.actor;
}

function scenarioActors(scenario: ScenarioDefinition): Actor[] {
  return [...new Set(scenario.steps.map((step) => step.actor))];
}

async function runCommand(spec: {
  actor: CommandResult["actor"];
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  inheritEnv?: boolean;
  timeoutMs: number;
}, dependencies: Dependencies): Promise<CommandResult> {
  const spawnCommand = dependencies.spawnCommand ?? spawn;
  const start = now(dependencies);
  return new Promise((resolve) => {
    const child = spawnCommand(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...(spec.inheritEnv === false ? {} : process.env), ...spec.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const maxOutputBytes = dependencies.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const stdoutCapture = createBoundedOutputCapture();
    const stderrCapture = createBoundedOutputCapture();
    let timedOut = false;
    let settled = false;
    let killTimeout: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      signalChild(child, "SIGTERM", dependencies);
      killTimeout = setTimeout(() => {
        signalChild(child, "SIGKILL", dependencies);
      }, dependencies.commandKillGraceMs ?? DEFAULT_COMMAND_KILL_GRACE_MS);
    }, spec.timeoutMs);

    const finish = (result: Omit<CommandResult, "actor" | "command" | "args" | "elapsedMs">): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (killTimeout !== undefined) {
        clearTimeout(killTimeout);
      }
      resolve({
        actor: spec.actor,
        command: spec.command,
        args: spec.args,
        elapsedMs: now(dependencies) - start,
        ...result,
      });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      appendBoundedOutput(stdoutCapture, chunk, maxOutputBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      appendBoundedOutput(stderrCapture, chunk, maxOutputBytes);
    });
    child.on("error", (error) => {
      finish({
        spawnError: errorMessage(error),
        status: null,
        signal: null,
        timedOut,
        stdout: boundedOutputText(stdoutCapture),
        stderr: boundedOutputText(stderrCapture),
        stdoutTruncated: stdoutCapture.truncatedBytes > 0,
        stderrTruncated: stderrCapture.truncatedBytes > 0,
      });
    });
    child.on("close", (status, signal) => {
      const stdout = boundedOutputText(stdoutCapture);
      const stderr = boundedOutputText(stderrCapture);
      finish({
        status,
        signal,
        timedOut,
        stdout,
        stderr,
        stdoutTruncated: stdoutCapture.truncatedBytes > 0,
        stderrTruncated: stderrCapture.truncatedBytes > 0,
      });
    });
  });
}

function signalChild(
  child: { pid?: number; kill: (signal?: NodeJS.Signals) => boolean },
  signal: NodeJS.Signals,
  dependencies: Dependencies,
): void {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      (dependencies.killProcess ?? process.kill)(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child for fakes or platforms without process groups.
    }
  }
  child.kill(signal);
}

function classifyPreflightResult(
  result: CommandResult,
  evidence: ParsedEvidence,
  base: Omit<Classification, "outcome" | "terminal" | "reason">,
): Classification {
  if (result.status !== 0) {
    return {
      ...base,
      outcome: result.stderr.includes("Invalid") && result.stderr.includes("chain identity") ? "wrong_chain" : "nonzero_exit",
      terminal: true,
      reason: boundedText(safeArtifactText(result.stderr), 240) || "preflight command exited nonzero",
    };
  }
  const report = evidence.records[0];
  if (report === undefined) {
    return {
      ...base,
      outcome: "malformed_evidence",
      terminal: true,
      reason: "preflight did not return a JSON report",
    };
  }
  return {
    ...base,
    outcome: "bot_no_action_skip",
    terminal: false,
    reason: "preflight succeeded",
  };
}

function classifyBotResult(
  result: CommandResult,
  evidence: ParsedEvidence,
  base: Omit<Classification, "outcome" | "terminal" | "reason">,
): Classification {
  const botRecords = evidence.records.filter(isBotRecord);
  const publicState = latestPublicState(botRecords);
  const failed = lastRecordOfType(botRecords, "bot.transaction.failed");
  if (failed !== undefined) {
    const outcome = stringField(failed, "outcome");
    const phase = stringField(failed, "phase");
    if (outcome === "timeout_after_broadcast") {
      return { ...base, outcome: "confirmation_timeout", terminal: true, reason: "bot tx confirmation timed out", publicState };
    }
    if (outcome === "post_broadcast_unresolved") {
      return { ...base, outcome: "post_broadcast_unresolved", terminal: true, reason: "bot tx remained unresolved after broadcast", publicState };
    }
    if (outcome === "terminal_rejection") {
      return { ...base, outcome: "terminal_chain_rejection", terminal: true, reason: "bot tx reached terminal chain rejection", publicState };
    }
    if (phase === "pre_broadcast") {
      return { ...base, outcome: "unknown", terminal: true, reason: "bot pre-broadcast transaction failure", publicState };
    }
  }

  const skip = lastRecordOfType(botRecords, "bot.decision.skipped");
  if (skip !== undefined && stringField(skip, "reason") === "capital_below_minimum") {
    return {
      ...base,
      outcome: "low_capital_stop",
      terminal: true,
      reason: "bot reported capital_below_minimum",
      actions: actionCounts(skip["actions"]),
      skipReason: "capital_below_minimum",
      publicState,
    };
  }

  if (result.status !== 0) {
    return {
      ...base,
      outcome: "nonzero_exit",
      terminal: true,
      reason: `bot exited with status ${String(result.status)}`,
      publicState,
    };
  }

  const committed = lastRecordOfType(botRecords, "bot.transaction.committed");
  if (committed !== undefined) {
    if (!hasValidTxHash(committed)) {
      return { ...base, outcome: "malformed_evidence", terminal: true, reason: "bot committed transaction evidence did not include a valid tx hash", publicState };
    }
    const actions = latestBotActions(botRecords) ?? emptyActions();
    return {
      ...base,
      outcome: classifyBotCommittedActions(actions),
      terminal: false,
      reason: "bot transaction committed according to app evidence",
      actions,
      publicState,
    };
  }

  if (skip !== undefined) {
    const reason = stringField(skip, "reason") ?? "unknown";
    const actions = actionCounts(skip["actions"]);
    if (reason === "post_tx_ckb_reserve") {
      return {
        ...base,
        outcome: "bot_reserve_skip",
        terminal: false,
        reason: "bot skipped to preserve CKB reserve",
        actions,
        skipReason: reason,
        publicState,
      };
    }
    return {
      ...base,
      outcome: "bot_no_action_skip",
      terminal: false,
      reason: `bot skipped: ${reason}`,
      actions,
      skipReason: reason,
      publicState,
    };
  }
  return { ...base, outcome: "unknown", terminal: true, reason: "bot produced no classifiable terminal evidence", publicState };
}

function classifyTesterResult(
  result: CommandResult,
  evidence: ParsedEvidence,
  base: Omit<Classification, "outcome" | "terminal" | "reason">,
  expectation?: TesterEvidenceExpectation,
): Classification {
  const testerLogs = evidence.records.filter((record) => !isBotRecord(record));
  const latest = testerLogs.at(-1);
  if (latest !== undefined) {
    const error = latest["error"];
    if (error !== undefined) {
      if (hasTimeoutError(error)) {
        return { ...base, outcome: "confirmation_timeout", terminal: true, reason: "tester transaction confirmation timed out" };
      }
      if (isTesterFundingError(error)) {
        return { ...base, outcome: "low_capital_stop", terminal: true, reason: "tester reported insufficient funds" };
      }
      return {
        ...base,
        outcome: "tester_deterministic_pre_broadcast_error",
        terminal: true,
        reason: "tester recorded an error before a committed transaction was proven",
      };
    }
  }
  if (result.status !== 0) {
    return { ...base, outcome: "nonzero_exit", terminal: true, reason: `tester exited with status ${String(result.status)}` };
  }
  if (latest !== undefined) {
    const skip = recordField(latest, "skip");
    if (skip !== undefined) {
      const reason = stringField(skip, "reason") ?? "unknown";
      if (reason === "fresh-matchable-order") {
        return { ...base, outcome: "tester_fresh_order_skip", terminal: false, reason: "tester skipped fresh matchable order", skipReason: reason };
      }
      if (reason === "sampled-amount-too-small") {
        return { ...base, outcome: "tester_sampled_too_small_skip", terminal: false, reason: "tester sampled amount too small", skipReason: reason };
      }
      if (reason === "estimated-conversion-too-small") {
        return { ...base, outcome: "tester_estimated_too_small_skip", terminal: false, reason: "tester estimate converted amount too small", skipReason: reason };
      }
      if (reason === "post-tx-ckb-reserve") {
        return { ...base, outcome: "tester_reserve_skip", terminal: false, reason: "tester skipped to preserve CKB reserve", skipReason: reason };
      }
      return { ...base, outcome: "unknown", terminal: true, reason: `tester skip reason is not classified: ${reason}`, skipReason: reason };
    }

    if ("txHash" in latest) {
      if (!hasValidTxHash(latest)) {
        return { ...base, outcome: "malformed_evidence", terminal: true, reason: "tester committed transaction evidence did not include a valid tx hash" };
      }
      const actions = recordField(latest, "actions");
      const expectationFailure = validateTesterEvidenceExpectation(actions, expectation);
      if (expectationFailure !== undefined) {
        return { ...base, outcome: "tester_deterministic_pre_broadcast_error", terminal: true, reason: expectationFailure };
      }
      const conversionKind = stringField(recordField(actions ?? {}, "conversion"), "kind");
      if (conversionKind !== undefined) {
        return { ...base, outcome: "tester_conversion_created", terminal: false, reason: "tester created a direct conversion transaction" };
      }
      return { ...base, outcome: "tester_order_created", terminal: false, reason: "tester created an order transaction" };
    }
  }
  return { ...base, outcome: "unknown", terminal: true, reason: "tester produced no classifiable terminal evidence" };
}

function validateTesterEvidenceExpectation(actions: Record<string, unknown> | undefined, expectation: TesterEvidenceExpectation | undefined): string | undefined {
  if (expectation === undefined) {
    return undefined;
  }
  if (actions === undefined) {
    return `tester committed tx without actions for expected scenario ${expectation.scenario}`;
  }
  const loggedScenario = stringField(actions, "testerScenario");
  if (expectation.scenario === "multi-order-limit-orders") {
    return validateAnyMultiOrders(actions, expectation.scenario);
  }
  if (loggedScenario !== expectation.scenario) {
    return `tester committed tx for scenario ${loggedScenario ?? "unknown"}, expected ${expectation.scenario}`;
  }
  if (isSdkConversionTesterScenario(expectation.scenario)) {
    return recordField(actions, "conversion") === undefined
      ? `tester scenario ${expectation.scenario} committed without conversion evidence`
      : undefined;
  }
  if (expectation.scenario === "two-ckb-to-ickb-limit-orders") {
    return validateMultiOrders(actions, 2, expectation.scenario, "giveCkb", "takeIckb");
  }
  if (expectation.scenario === "two-ickb-to-ckb-limit-orders") {
    return validateMultiOrders(actions, 2, expectation.scenario, "giveIckb", "takeCkb");
  }
  if (expectation.scenario === "mixed-direction-limit-orders") {
    return validateMixedDirectionOrders(actions, expectation.scenario);
  }
  const newOrder = recordField(actions, "newOrder");
  if (newOrder === undefined) {
    return `tester scenario ${expectation.scenario} committed without new order evidence`;
  }
  if (expectation.scenario === "random-order") {
    return hasOrderFields(newOrder, "giveCkb", "takeIckb") || hasOrderFields(newOrder, "giveIckb", "takeCkb")
      ? undefined
      : "tester scenario random-order committed with wrong order direction evidence";
  }
  return isIckbToCkbTesterScenario(expectation.scenario)
    ? requireOrderFields(expectation.scenario, newOrder, "giveIckb", "takeCkb")
    : requireOrderFields(expectation.scenario, newOrder, "giveCkb", "takeIckb");
}

function validateAnyMultiOrders(actions: Record<string, unknown>, scenario: TesterScenario): string | undefined {
  const loggedScenario = stringField(actions, "testerScenario");
  if (loggedScenario === "two-ckb-to-ickb-limit-orders") {
    return validateMultiOrders(actions, 2, scenario, "giveCkb", "takeIckb");
  }
  if (loggedScenario === "two-ickb-to-ckb-limit-orders") {
    return validateMultiOrders(actions, 2, scenario, "giveIckb", "takeCkb");
  }
  if (loggedScenario === "mixed-direction-limit-orders") {
    return validateMixedDirectionOrders(actions, scenario);
  }
  return `tester scenario ${scenario} committed with non-multi-order selected scenario evidence`;
}

function validateMultiOrders(actions: Record<string, unknown>, expectedCount: number, scenario: TesterScenario, giveField: string, takeField: string): string | undefined {
  const newOrders = arrayField(actions, "newOrders");
  if (newOrders === undefined || newOrders.length !== expectedCount) {
    return `tester scenario ${scenario} committed without ${String(expectedCount)} new order evidence entries`;
  }
  if (numberField(actions, "orderCount") !== expectedCount) {
    return `tester scenario ${scenario} committed with wrong order count evidence`;
  }
  return newOrders.every((order) => isRecord(order) && hasOrderFields(order, giveField, takeField))
    ? undefined
    : `tester scenario ${scenario} committed with wrong order direction evidence`;
}

function validateMixedDirectionOrders(actions: Record<string, unknown>, scenario: TesterScenario): string | undefined {
  const newOrders = arrayField(actions, "newOrders");
  if (newOrders === undefined || newOrders.length !== 2) {
    return `tester scenario ${scenario} committed without 2 new order evidence entries`;
  }
  if (numberField(actions, "orderCount") !== 2) {
    return `tester scenario ${scenario} committed with wrong order count evidence`;
  }
  const directions = newOrders.map(orderDirection);
  return directions.includes("ckb-to-ickb") && directions.includes("ickb-to-ckb")
    ? undefined
    : `tester scenario ${scenario} committed without mixed order direction evidence`;
}

function orderDirection(order: unknown): TesterDirection | undefined {
  if (!isRecord(order)) {
    return undefined;
  }
  const ckbToIckb = hasOrderFields(order, "giveCkb", "takeIckb");
  const ickbToCkb = hasOrderFields(order, "giveIckb", "takeCkb");
  if (ckbToIckb === ickbToCkb) {
    return undefined;
  }
  return ckbToIckb ? "ckb-to-ickb" : "ickb-to-ckb";
}

function requireOrderFields(scenario: TesterScenario, newOrder: Record<string, unknown>, giveField: string, takeField: string): string | undefined {
  if (hasOrderFields(newOrder, giveField, takeField)) {
    return undefined;
  }
  return `tester scenario ${scenario} committed with wrong order direction evidence`;
}

function hasOrderFields(newOrder: Record<string, unknown>, giveField: string, takeField: string): boolean {
  return typeof newOrder[giveField] === "string" && typeof newOrder[takeField] === "string";
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
}

function isSdkConversionTesterScenario(scenario: TesterScenario): boolean {
  return scenario === "sdk-conversion";
}

function isIckbToCkbTesterScenario(scenario: TesterScenario): boolean {
  return scenario === "all-ickb-limit-order" || scenario === "ickb-to-ckb-limit-order" || scenario === "two-ickb-to-ckb-limit-orders" || scenario === "dust-ickb-conversion";
}

function classifyBotCommittedActions(actions: ActionCounts): OutcomeKind {
  if (actions.matchedOrders > 0 && actions.deposits > 0) {
    return "bot_match_plus_deposit_committed";
  }
  if (actions.matchedOrders > 0) {
    return "bot_match_committed";
  }
  if (actions.completedDeposits > 0) {
    return "bot_receipt_completion_committed";
  }
  if (actions.deposits > 0) {
    return "bot_deposit_only_committed";
  }
  if (actions.withdrawalRequests > 0) {
    return "bot_withdrawal_request_committed";
  }
  if (actions.withdrawals > 0) {
    return "bot_withdrawal_completion_committed";
  }
  return "unknown";
}

function unsupportedClassification(choice: UnsupportedScenarioChoice): Classification {
  return {
    actor: "preflight",
    outcome: "unknown",
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
    },
  };
}

function unmetExplicitGoals(args: Pick<ParsedArgs, "targetOutcomes">, ledger: CoverageLedger): OutcomeKind[] {
  return explicitCoverageGoals(args).filter((outcome) => ledger.counts[outcome] === 0);
}

function explicitCoverageGoals(args: Pick<ParsedArgs, "targetOutcomes">): OutcomeKind[] {
  return [...new Set(args.targetOutcomes)];
}

async function writeUnmetCoverageIncident(
  plan: SupervisorPlan,
  cycleIndex: number,
  unmetGoals: OutcomeKind[],
  ledger: CoverageLedger,
  artifacts: string[],
  dependencies: Dependencies,
): Promise<IncidentArtifact> {
  const classification: Classification = {
    actor: "preflight",
    outcome: "unmet_coverage_goal",
    terminal: true,
    reason: `bounded cycle budget ended before observing requested outcomes: ${unmetGoals.join(", ")}`,
    txHashes: [],
    evidence: {
      recordsAccepted: 0,
      ignoredLineCount: 0,
      malformedLineCount: 0,
      exitStatus: null,
      signal: null,
      timedOut: false,
    },
  };
  const relativePath = await writeJsonArtifact(plan, `cycle-${padCycle(cycleIndex)}-incident.json`, {
    runId: plan.runId,
    cycleIndex,
    actor: "supervisor",
    classification,
    unmetGoals,
    coverage: coverageSummary(ledger),
    artifacts,
    suggestedNextAction: suggestedNextAction(classification),
  }, artifacts, dependencies);
  return { relativePath, classification };
}

async function writeIncident(
  plan: SupervisorPlan,
  cycleIndex: number,
  actor: Actor,
  choice: ScenarioChoice,
  classification: Classification,
  result: CommandResult,
  ledger: CoverageLedger,
  artifacts: string[],
  dependencies: Dependencies,
): Promise<IncidentArtifact> {
  const relativePath = await writeJsonArtifact(plan, `cycle-${padCycle(cycleIndex)}-incident.json`, {
    runId: plan.runId,
    cycleIndex,
    actor,
    scenario: choice.scenario.name,
    targetOutcomes: choice.targetOutcomes,
    command: redactedCommandShape(plan, result),
    exit: {
      spawnError: result.spawnError,
      status: result.status,
      signal: result.signal,
      timedOut: result.timedOut,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      elapsedMs: result.elapsedMs,
    },
    classification,
    coverage: coverageSummary(ledger),
    stdoutExcerpt: boundedText(safeArtifactText(result.stdout), 4000),
    stderrExcerpt: boundedText(safeArtifactText(result.stderr), 4000),
    artifacts,
    suggestedNextAction: suggestedNextAction(classification),
  }, artifacts, dependencies);
  return { relativePath, classification };
}

function unsupportedIncident(
  plan: SupervisorPlan,
  cycleIndex: number,
  choice: UnsupportedScenarioChoice,
  ledger: CoverageLedger,
  classification: Classification,
): Record<string, unknown> {
  return {
    runId: plan.runId,
    cycleIndex,
    actor: "supervisor",
    classification,
    requested: choice.requested,
    coverage: coverageSummary(ledger),
    suggestedNextAction: "provide an alternate ignored config or add a tested supervisor/test-harness control surface; do not mutate funded configs in place",
  };
}

async function writeSummary(
  plan: SupervisorPlan,
  ledger: CoverageLedger,
  classifications: Classification[],
  artifacts: string[],
  latestPublicState: PublicStateAssumption | undefined,
  stopReason: string,
  dependencies: Dependencies,
): Promise<string> {
  return await writeJsonArtifact(plan, "summary.json", {
    runId: plan.runId,
    stopped: stopReason,
    artifacts,
    aggregateCounts: aggregateClassifications(classifications),
    txHashesByOutcome: txHashesByOutcome(classifications),
    skipReasons: classifications.map((item) => item.skipReason).filter((item) => item !== undefined),
    scenarioAttempts: ledger.attempts,
    coverage: coverageSummary(ledger),
    publicVsOwnedStateAssumptions: latestPublicState ?? null,
  }, artifacts, dependencies);
}

async function writeCommandArtifacts(
  plan: SupervisorPlan,
  cycleIndex: number,
  label: string,
  result: CommandResult,
  dependencies: Dependencies,
): Promise<string[]> {
  const base = `cycle-${padCycle(cycleIndex)}-${label}`;
  const stdoutPath = await writeTextArtifact(plan, `${base}.stdout.ndjson`, safeArtifactText(result.stdout), dependencies);
  const stderrPath = await writeTextArtifact(plan, `${base}.stderr.log`, safeArtifactText(result.stderr), dependencies);
  const commandPath = await writeJsonArtifact(plan, `${base}.command.json`, {
    command: redactedCommandShape(plan, result),
    exit: {
      spawnError: result.spawnError,
      status: result.status,
      signal: result.signal,
      timedOut: result.timedOut,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      elapsedMs: result.elapsedMs,
    },
  }, [], dependencies);
  return [stdoutPath, stderrPath, commandPath];
}

async function writeTextArtifact(plan: SupervisorPlan, fileName: string, text: string, dependencies: Dependencies): Promise<string> {
  const writeFileFn = dependencies.writeFile ?? writeFile;
  const artifactPath = join(plan.outDir, fileName);
  await writeFileFn(artifactPath, text);
  return relative(plan.rootDir, artifactPath);
}

async function writeJsonArtifact(
  plan: SupervisorPlan,
  fileName: string,
  value: unknown,
  artifacts: string[],
  dependencies: Dependencies,
): Promise<string> {
  const writeFileFn = dependencies.writeFile ?? writeFile;
  const artifactPath = join(plan.outDir, fileName);
  await writeFileFn(artifactPath, `${JSON.stringify(value, jsonReplacer, 2)}\n`);
  const relativePath = relative(plan.rootDir, artifactPath);
  if (!artifacts.includes(relativePath)) {
    artifacts.push(relativePath);
  }
  return relativePath;
}

async function appendSupervisorEvent(plan: SupervisorPlan, fields: Record<string, unknown>, dependencies: Dependencies): Promise<void> {
  const appendFileFn = dependencies.appendFile ?? appendFile;
  await appendFileFn(join(plan.outDir, "supervisor.ndjson"), `${JSON.stringify({
    version: 1,
    app: "supervisor",
    runId: plan.runId,
    timestamp: new Date().toISOString(),
    ...fields,
  }, jsonReplacer)}\n`);
}

function redactedCommandShape(plan: SupervisorPlan, result: CommandResult): Record<string, unknown> {
  return {
    command: result.command === process.execPath ? "node" : result.command,
    args: result.args.map((arg) => arg === plan.botConfigPath
      ? "<bot-config-path>"
      : arg === plan.testerConfigPath
        ? "<tester-config-path>"
        : arg),
  };
}

function aggregateClassifications(classifications: Classification[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const classification of classifications) {
    counts.set(classification.outcome, (counts.get(classification.outcome) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

function txHashesByOutcome(classifications: Classification[]): Record<string, string[]> {
  const hashes = new Map<string, string[]>();
  for (const classification of classifications) {
    if (classification.txHashes.length === 0) {
      continue;
    }
    hashes.set(classification.outcome, [
      ...(hashes.get(classification.outcome) ?? []),
      ...classification.txHashes,
    ]);
  }
  return Object.fromEntries(hashes);
}

function txCreatingHashCount(classification: Classification): number {
  return TX_CREATING_OUTCOMES.has(classification.outcome) ? classification.txHashes.length : 0;
}

function coverageSummary(ledger: CoverageLedger): Record<string, unknown> {
  return {
    goals: ledger.goals,
    covered: ledger.goals.filter((goal) => ledger.counts[goal] > 0),
    uncovered: ledger.goals.filter((goal) => ledger.counts[goal] === 0),
    counts: ledger.counts,
    attempts: ledger.attempts,
    unsupported: ledger.unsupported,
  };
}

function suggestedNextAction(classification: Classification): string {
  if (classification.outcome === "confirmation_timeout" || classification.outcome === "post_broadcast_unresolved") {
    return "confirm the tx hash with a read-only chain query before sending any follow-up work";
  }
  if (classification.outcome === "secret_leak_sentinel") {
    return "stop, inspect artifacts for leakage, and rotate any exposed disposable key before relaunch";
  }
  if (classification.outcome === "low_capital_stop") {
    return "fund the supervised account or provide an alternate ignored config, then rerun a bounded smoke";
  }
  return "inspect the incident bundle and run a review pass for material code changes before extended relaunch";
}

function latestBotActions(records: Record<string, unknown>[]): ActionCounts | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record === undefined) {
      continue;
    }
    if (stringField(record, "type") === "bot.transaction.built") {
      return actionCounts(record["actions"]);
    }
  }
  return undefined;
}

function latestPublicState(records: Record<string, unknown>[]): PublicStateAssumption | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record === undefined) {
      continue;
    }
    if (stringField(record, "type") !== "bot.state.read") {
      continue;
    }
    const orders = recordField(record, "orders");
    const poolDeposits = recordField(record, "poolDeposits");
    return {
      marketOrderCount: numberField(orders, "marketCount"),
      userOrderCount: numberField(orders, "userCount"),
      receiptCount: numberField(orders, "receiptCount"),
      readyPoolDepositCount: numberField(poolDeposits, "readyCount"),
      nearReadyPoolDepositCount: numberField(poolDeposits, "nearReadyCount"),
      futurePoolDepositCount: numberField(poolDeposits, "futureCount"),
    };
  }
  return undefined;
}

function actionCounts(value: unknown): ActionCounts {
  const record = isRecord(value) ? value : {};
  return {
    collectedOrders: numberField(record, "collectedOrders") ?? 0,
    completedDeposits: numberField(record, "completedDeposits") ?? 0,
    matchedOrders: numberField(record, "matchedOrders") ?? 0,
    deposits: numberField(record, "deposits") ?? 0,
    withdrawalRequests: numberField(record, "withdrawalRequests") ?? 0,
    withdrawals: numberField(record, "withdrawals") ?? 0,
  };
}

function emptyActions(): ActionCounts {
  return {
    collectedOrders: 0,
    completedDeposits: 0,
    matchedOrders: 0,
    deposits: 0,
    withdrawalRequests: 0,
    withdrawals: 0,
  };
}

function extractTxHashes(records: Record<string, unknown>[]): string[] {
  const hashes = new Set<string>();
  for (const record of records) {
    const txHash = record["txHash"];
    if (typeof txHash === "string" && TX_HASH_PATTERN.test(txHash)) {
      hashes.add(txHash);
    }
    const skip = recordField(record, "skip");
    const skipTxHash = skip?.["txHash"];
    if (typeof skipTxHash === "string" && TX_HASH_PATTERN.test(skipTxHash)) {
      hashes.add(skipTxHash);
    }
  }
  return [...hashes];
}

function hasValidTxHash(record: Record<string, unknown>): boolean {
  const txHash = record["txHash"];
  return typeof txHash === "string" && TX_HASH_PATTERN.test(txHash);
}

function containsSecretLeak(text: string): boolean {
  return /["']?(private[-_]?key|mnemonic|seed[-_]?phrase)["']?\s*[:=]/iu.test(text) ||
    /["']?rpc[-_]?url["']?\s*[:=]\s*["']?https?:\/\/[^\s"']*(?:@|[?&][^\s"']*=)/iu.test(text);
}

function containsTransactionLeak(text: string): boolean {
  return /["']?(witnesses|cellDeps|headerDeps|inputs|outputs|outputsData)["']?\s*:/iu.test(text);
}

export function safeArtifactText(text: string): string {
  if (containsSecretLeak(text)) {
    return "<redacted: secret-shaped output withheld by supervisor>\n";
  }
  if (containsTransactionLeak(text)) {
    return "<redacted: transaction-shaped output withheld by supervisor>\n";
  }
  return text;
}

function minimalProcessEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(["PATH", "HOME", "LANG", "LC_ALL", "TERM"].flatMap((key) => {
    const value = env[key];
    return value === undefined ? [] : [[key, value]];
  }));
}

function liveActorEnv(extra: Record<string, string>): Record<string, string> {
  return {
    ...minimalProcessEnv(process.env),
    ...extra,
  };
}

function hasTimeoutError(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return value["isTimeout"] === true || stringField(value, "name") === "TransactionConfirmationError";
}

function isTesterFundingError(value: unknown): boolean {
  const message = typeof value === "string" ? value : stringField(isRecord(value) ? value : undefined, "message");
  return message !== undefined && /Not enough (?:funds|CKB|iCKB)/u.test(message);
}

function isBotRecord(record: Record<string, unknown>): boolean {
  return record["app"] === "bot";
}

function lastRecordOfType(records: Record<string, unknown>[], type: string): Record<string, unknown> | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record === undefined) {
      continue;
    }
    if (stringField(record, "type") === type) {
      return record;
    }
  }
  return undefined;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scenarioByName(name: Exclude<ScenarioName, "auto">): ScenarioDefinition {
  const scenario = SCENARIOS.find((candidate) => candidate.name === name);
  if (scenario === undefined) {
    throw new Error(`Unknown scenario: ${name}`);
  }
  return scenario;
}

function parseOutcome(value: string, flag: string): OutcomeKind {
  if (OUTCOME_SET.has(value as OutcomeKind)) {
    return value as OutcomeKind;
  }
  throw new Error(`Invalid ${flag}: unknown outcome ${value}`);
}

function parseScenarioName(value: string): ScenarioName {
  if (value === "auto" || value === "standard-cycle" || value === "tester-only" || value === "bot-only" || value === "tester-fresh-skip-two-pass") {
    return value;
  }
  throw new Error("Invalid --scenario: expected auto, standard-cycle, tester-only, bot-only, or tester-fresh-skip-two-pass");
}

function parseTesterScenario(value: string): TesterScenario {
  if (
    value === "auto" ||
    value === "random-order" ||
    value === "sdk-conversion" ||
    value === "extra-large-limit-order" ||
    value === "multi-order-limit-orders" ||
    value === "two-ckb-to-ickb-limit-orders" ||
    value === "all-ckb-limit-order" ||
    value === "all-ickb-limit-order" ||
    value === "ickb-to-ckb-limit-order" ||
    value === "two-ickb-to-ckb-limit-orders" ||
    value === "mixed-direction-limit-orders" ||
    value === "dust-ckb-conversion" ||
    value === "dust-ickb-conversion"
  ) {
    return value;
  }
  throw new Error("Invalid --tester-scenario: expected auto, random-order, sdk-conversion, extra-large-limit-order, multi-order-limit-orders, two-ckb-to-ickb-limit-orders, all-ckb-limit-order, all-ickb-limit-order, ickb-to-ckb-limit-order, two-ickb-to-ckb-limit-orders, mixed-direction-limit-orders, dust-ckb-conversion, or dust-ickb-conversion");
}

function valueAfter(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected a positive integer`);
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Invalid ${flag}: expected a safe integer`);
  }
  return Number(parsed);
}

function parseTesterFeeValue(value: string, flag: string): string {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected an unsigned integer`);
  }
  return value;
}

function insideRepoPath(rootDir: string, path: string, label: string): string {
  if (path === "") {
    throw new Error(`${label} must not be empty`);
  }
  const absolutePath = isAbsolute(path) ? path : resolve(rootDir, path);
  const relativePath = relative(rootDir, absolutePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside the repo`);
  }
  return absolutePath;
}

function assertSupervisorOutputDirectory(relativeOutDir: string): void {
  if (relativeOutDir === "logs/live-supervisor" || relativeOutDir.startsWith(SUPERVISOR_OUTPUT_ROOT)) {
    return;
  }
  throw new Error(`Supervisor output directory must be under ${SUPERVISOR_OUTPUT_ROOT}`);
}

function assertIgnoredConfigPath(
  rootDir: string,
  absolutePath: string,
  label: string,
  dependencies: Dependencies,
): void {
  const relativePath = relative(rootDir, absolutePath);
  if (!isIgnoredPath(rootDir, relativePath, dependencies)) {
    throw new Error(`Refusing to use non-ignored ${label}: ${relativePath}`);
  }
}

async function assertNoSymlinkedConfigPath(
  rootDir: string,
  absolutePath: string,
  label: string,
  dependencies: Dependencies,
): Promise<void> {
  const lstatFn = dependencies.lstat ?? lstat;
  const parts = relative(rootDir, absolutePath).split("/").filter((part) => part !== "");
  let current = rootDir;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stats = await lstatFn(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing to use ${label} through symlinked path: ${relative(rootDir, current)}`);
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }
}

function isIgnoredPath(rootDir: string, relativePath: string, dependencies: Dependencies): boolean {
  const spawnSyncCommand = dependencies.spawnSyncCommand ?? spawnSync;
  const result: SpawnSyncReturns<string> = spawnSyncCommand("git", ["-C", rootDir, "check-ignore", "--", relativePath], {
    encoding: "utf8",
  });
  return result.status === 0;
}

export function createBoundedOutputCapture(): BoundedOutputCapture {
  return { chunks: [], byteLength: 0, truncatedBytes: 0 };
}

export function appendBoundedOutput(capture: BoundedOutputCapture, chunk: Buffer, maxBytes: number): void {
  if (maxBytes < 1) {
    capture.truncatedBytes += chunk.length;
    return;
  }
  const remaining = maxBytes - capture.byteLength;
  if (remaining <= 0) {
    capture.truncatedBytes += chunk.length;
    return;
  }
  const kept = chunk.subarray(0, remaining);
  capture.chunks.push(kept);
  capture.byteLength += kept.length;
  capture.truncatedBytes += chunk.length - kept.length;
}

export function boundedOutputText(capture: BoundedOutputCapture): string {
  const text = Buffer.concat(capture.chunks).toString("utf8");
  return capture.truncatedBytes === 0
    ? text
    : `${text}\n<truncated ${String(capture.truncatedBytes)} bytes>`;
}

function createRunId(): string {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

function now(dependencies: Dependencies): number {
  return dependencies.now?.() ?? Date.now();
}

function padCycle(cycleIndex: number): string {
  return cycleIndex.toString().padStart(4, "0");
}

function boundedText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n<truncated ${String(text.length - limit)} bytes>`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function fixtureResult(actor: Actor, stdout: string): CommandResult {
  return {
    actor,
    command: "fixture",
    args: [],
    status: 0,
    signal: null,
    timedOut: false,
    stdout: `${stdout}\n`,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    elapsedMs: 1,
  };
}

function botEvent(type: string, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 1,
    app: "bot",
    chain: "testnet",
    runId: "dry-run",
    iterationId: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    type,
    ...fields,
  };
}

function sampleTxHash(byte: string): string {
  return `0x${byte.repeat(32)}`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
