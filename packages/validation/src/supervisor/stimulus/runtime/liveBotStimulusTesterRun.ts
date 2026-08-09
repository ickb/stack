import pathModule from "node:path";
import {
  aggregateCounts,
  readJson,
  writeText,
} from "../artifacts/liveBotStimulusArtifacts.ts";
import { proveLiveLauncher } from "../preflight/liveBotStimulusPreflight.ts";
import { testerOrderCreatedTxHash } from "../selection/liveBotStimulusEventScan.ts";
import {
  SUMMARY_JSON,
  SUPERVISOR_DIR,
  TESTER_ORDER_CREATED,
} from "../shared/liveBotStimulusConstants.ts";
import type {
  LauncherProof,
  LiveBotStimulusDependencies,
  ParsedStimulusArgs,
  SessionPaths,
  StimulusChoice,
  StimulusRunResult,
  WritableLike,
} from "../shared/liveBotStimulusTypes.ts";
import {
  displayPath,
  isRecord,
  throwIfInterrupted,
} from "../shared/liveBotStimulusUtils.ts";
const { join } = pathModule;

export async function runTesterStimulus(
  ...[root, args, paths, choice, launcher, dependencies]: [
    root: string,
    args: ParsedStimulusArgs,
    paths: SessionPaths,
    choice: StimulusChoice,
    launcher: LauncherProof,
    dependencies: LiveBotStimulusDependencies,
  ]
): Promise<StimulusRunResult> {
  const outDir = join(paths.chunksDir, "chunk-0001", "run-0001");
  const supervisorArgs = [
    "--tester-config",
    args.testerConfig,
    "--out-dir",
    displayPath(root, outDir),
    "--scenario",
    "tester-only",
    "--tester-scenario",
    choice.scenario,
    "--target-outcome",
    TESTER_ORDER_CREATED,
    "--max-cycles",
    "1",
    "--stop-after-tx-count",
    "1",
    "--command-timeout-seconds",
    String(args.commandTimeoutSeconds),
    ...feeArgs(choice),
  ];
  const stdout = stringWriter();
  const stderr = stringWriter();
  await proveLiveLauncher(paths, dependencies, launcher);
  let status: number;
  try {
    status = await dependencies.runSupervisor(supervisorArgs, { stdout, stderr });
    throwIfInterrupted(dependencies);
  } finally {
    await writeText(paths, `${SUPERVISOR_DIR}/stdout.log`, stdout.text, dependencies);
    await writeText(paths, `${SUPERVISOR_DIR}/stderr.log`, stderr.text, dependencies);
  }
  const summaryPath = join(outDir, SUMMARY_JSON);
  let summary: Record<string, unknown> | undefined;
  try {
    summary = await readJson(summaryPath, dependencies);
  } catch {
    summary = undefined;
  }
  return {
    status,
    outDir,
    summaryPath,
    stdout: stdout.text,
    stderr: stderr.text,
    summary,
  };
}

export function testerStimulusSucceeded(
  stimulus: StimulusRunResult,
): { ok: true; txHash: string } | { ok: false; reason: string } {
  if (stimulus.status !== 0) {
    return {
      ok: false,
      reason: `tester stimulus supervisor exited with status ${String(stimulus.status)}`,
    };
  }
  const summary = stimulus.summary;
  if (summary === undefined) {
    return { ok: false, reason: "tester stimulus summary.json missing" };
  }
  if (hasIncidentArtifact(summary)) {
    return { ok: false, reason: "tester stimulus wrote an incident artifact" };
  }
  const counts = aggregateCounts(summary);
  const txHash = testerOrderCreatedTxHash(summary);
  if (
    counts[TESTER_ORDER_CREATED] !== 1 ||
    !hasExactlyOneNonDustOrder(summary) ||
    txHash === undefined
  ) {
    return {
      ok: false,
      reason: "tester stimulus did not create exactly one non-dust order transaction",
    };
  }
  return { ok: true, txHash };
}

function hasExactlyOneNonDustOrder(summary: Record<string, unknown>): boolean {
  const evidence = summary["testerOrderEvidence"];
  if (!Array.isArray(evidence)) {
    return false;
  }
  const created = evidence.filter(
    (item: unknown): item is Record<string, unknown> =>
      isRecord(item) && item["outcome"] === TESTER_ORDER_CREATED,
  );
  const item = created[0];
  if (created.length !== 1 || item?.["orderCount"] !== 1) {
    return false;
  }
  const orders = item["orders"];
  return Array.isArray(orders) && orders.length === 1 && orders.every(isNonDustOrder);
}

function isNonDustOrder(value: unknown): boolean {
  return isRecord(value) && value["dust"] === false;
}

function hasIncidentArtifact(summary: Record<string, unknown>): boolean {
  const artifacts = summary["artifacts"];
  return (
    Array.isArray(artifacts) &&
    artifacts.some(
      (artifact) => typeof artifact === "string" && artifact.endsWith("incident.json"),
    )
  );
}

function feeArgs(choice: StimulusChoice): string[] {
  return [
    ...(choice.testerFee === undefined ? [] : ["--tester-fee", choice.testerFee]),
    ...(choice.testerFeeBase === undefined
      ? []
      : ["--tester-fee-base", choice.testerFeeBase]),
  ];
}

function stringWriter(): WritableLike & { text: string } {
  return {
    text: "",
    write(chunk: string): true {
      this.text += chunk;
      return true;
    },
  };
}
