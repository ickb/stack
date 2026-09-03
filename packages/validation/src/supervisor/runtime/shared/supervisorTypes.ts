import type { ProcessSignalContext } from "@ickb/node-utils";
import type { spawn, spawnSync } from "node:child_process";
import type { existsSync } from "node:fs";
import type {
  appendFile,
  lstat,
  mkdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import type {
  Actor,
  OutcomeKind,
  ScenarioName,
  ScenarioStep,
  TesterDirection,
  TesterScenario,
  TesterScenarioSelection,
} from "./supervisorConstants.ts";

export type { ScenarioStep };

export interface ParsedArgs {
  help: boolean;
  botConfigPath: string;
  testerConfigPath: string;
  outDir?: string;
  maxCycles: number;
  maxWallClockSeconds?: number;
  stopAfterTxCount?: number;
  scenario: ScenarioName;
  targetOutcomes: OutcomeKind[];
  testerScenario?: TesterScenarioSelection;
  testerFee?: string;
  testerFeeBase?: string;
  commandTimeoutSeconds: number;
}

export interface SupervisorPlan {
  runId: string;
  rootDir: string;
  botConfigPath: string;
  testerConfigPath: string;
  outDir: string;
  relativeOutDir: string;
  /** `--target-outcome` values, echoed as `requestedOutcomes` in summary.json. */
  targetOutcomes: OutcomeKind[];
  testerScenario?: TesterScenarioSelection;
  testerFee?: string;
  testerFeeBase?: string;
  commandTimeoutSeconds: number;
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
  timeoutMs: number;
}

export interface ParsedEvidence {
  records: Array<Record<string, unknown>>;
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
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  };
  actions?: ActionCounts;
  skipReason?: string;
  publicState?: PublicStateAssumption;
  testerOrder?: TesterOrderEvidence;
  retryableFailures?: RetryableFailureSummary[];
  botBalanceAudit?: BotBalanceAuditEvidence;
}

export type ClassificationBase = Omit<Classification, "outcome" | "terminal" | "reason">;

export interface RetryableFailureSummary {
  actor: Actor;
  type: string;
  iterationId?: number;
  phase?: string;
  outcome?: string;
  errorName?: string;
  errorCode?: number;
  currentFee?: string;
  leastFee?: string;
  outPoint?: { txHash: string; index: string };
}

export interface TesterEvidenceExpectation {
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

export interface BotBalanceAuditSnapshot {
  availableCkb: string;
  availableIckb: string;
  unavailableCkb: string;
  totalCkb: string;
}

export interface BotBalanceAuditStateRead {
  kind: "stateRead";
  iterationId?: number;
  balances?: BotBalanceAuditSnapshot;
}

export interface PendingBotBalanceAudit {
  kind: "commit";
  txHashes: string[];
  committedIterationId?: number;
  actions: ActionCounts;
}

export type BotBalanceAuditEvent = BotBalanceAuditStateRead | PendingBotBalanceAudit;

interface BotBalanceAuditEvidence {
  events: BotBalanceAuditEvent[];
}

export interface PublicStateAssumption {
  marketOrderCount?: number;
  userOrderCount?: number;
  receiptCount?: number;
  ckbToUdtMatchableOrderCount?: number;
  udtToCkbMatchableOrderCount?: number;
  viableMatchCandidateCount?: number;
  positiveGainMatchCandidateCount?: number;
  rebalanceKind?: string;
  rebalanceReason?: string;
  poolDepositCount?: number;
  readyPoolDepositCount?: number;
  ringCanCreateInventory?: boolean;
  ringTargetSegmentUdtValue?: string;
  ringTotalPoolUdt?: string;
}

export interface TesterOrderEvidence {
  requestedTesterScenario?: string;
  testerScenario?: string;
  orderCount: number;
  collectedOrders?: number;
  cancelledOrders?: number;
  orders: TesterOrderSummary[];
}

export interface TesterOrderSummary {
  direction?: TesterDirection;
  giveCkb?: string;
  takeIckb?: string;
  giveIckb?: string;
  takeCkb?: string;
  fee?: string;
  feeNumerator?: string;
  feeBase?: string;
  dust: boolean;
}

export interface PreflightStateSummary {
  cycleIndex: number;
  actor: Actor;
  step: string;
  selectedTesterScenario?: TesterScenarioSelection;
  balances?: {
    CKB?: {
      available: string;
      plainAvailable?: string;
      projectedAvailable?: string;
      spendable?: string;
    };
    ICKB?: { available: string; unavailable?: string; total?: string };
  };
}

export interface StopDiagnostics {
  reason: string;
  cycleIndex?: number;
  stage?: string;
  remainingWallClockMs?: number;
  requiredCommandStartBudgetMs?: number;
  configuredCommandTimeoutMs?: number;
  commandStartGraceMs?: number;
  maxWallClockSeconds?: number;
}

export type StopForUnavailableWallClockBudget = (
  incidentCycleIndex: number,
  stage: string,
  remainingWallClockMs?: number,
) => Promise<number | undefined>;

export type PreflightCkbBalanceSummary = NonNullable<
  PreflightStateSummary["balances"]
>["CKB"];

export type ParsedArgHandler = (
  args: ParsedArgs,
  argv: string[],
  index: number,
  flag: string,
) => number;

export interface Dependencies {
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
  processOn?: (signal: NodeJS.Signals, listener: () => void) => unknown;
  processOff?: (signal: NodeJS.Signals, listener: () => void) => unknown;
  processSignalContext?: ProcessSignalContext;
}

export type SupervisorDependencies = Dependencies & {
  actorEntrypoints: Record<Actor, string>;
};

export interface IncidentArtifact {
  relativePath: string;
  classification: Classification;
}

export interface SupervisorRunState {
  classifications: Classification[];
  artifacts: string[];
  preflightState: PreflightStateSummary[];
  txCount: number;
  latestPublicState: PublicStateAssumption | undefined;
  pendingBotBalanceAudit?: PendingBotBalanceAudit;
}

export interface ClassifiedCommandRun {
  result: CommandResult;
  classification: Classification;
}

export interface RunCommandSpec {
  actor: CommandResult["actor"];
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
}

export interface PublicStateAccumulator {
  matchDiagnosticsByIteration: Map<number, Record<string, unknown>>;
  rebalanceByIteration: Map<number, Record<string, unknown>>;
  ringAuditByIteration: Map<number, Record<string, unknown>>;
}
