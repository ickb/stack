import { ChildProcess } from "node:child_process";
import { Readable } from "node:stream";

import type {
  ClassificationBase,
  CommandResult,
  SupervisorDependencies,
  SupervisorPlan,
  SupervisorRunState,
  runCommand,
} from "../../../../src/supervisor/index.ts";
import { TEST_ACTOR_ENTRYPOINTS, noopVoid } from "../../support/supervisor/index.ts";

export function supervisorPlan(overrides: Partial<SupervisorPlan> = {}): SupervisorPlan {
  return {
    botConfigPath: "/repo/config/bot-testnet.json",
    testerConfigPath: "/repo/config/tester-testnet.json",
    commandTimeoutSeconds: 900,
    targetOutcomes: [],
    testerScenario: "auto",
    runId: "run",
    rootDir: "/repo",
    outDir: "/repo/log/live-supervisor/run",
    relativeOutDir: "log/live-supervisor/run",
    ...overrides,
  };
}

export function commandResult(
  actor: CommandResult["actor"],
  stdout: string,
  overrides: Partial<CommandResult> = {},
): CommandResult {
  return {
    actor,
    command: process.execPath,
    args: [],
    status: 0,
    signal: null,
    timedOut: false,
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    elapsedMs: 1,
    timeoutMs: 1000,
    ...overrides,
  };
}

export function commandSpec(): Parameters<typeof runCommand>[0] {
  return {
    actor: "bot",
    command: process.execPath,
    args: ["-e", ""],
    cwd: "/repo",
    env: {},
    timeoutMs: 1000,
  };
}

export function classificationBase(
  actor: ClassificationBase["actor"],
): ClassificationBase {
  return {
    actor,
    evidence: {
      recordsAccepted: 0,
      ignoredLineCount: 0,
      malformedLineCount: 0,
      exitStatus: 0,
      signal: null,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    },
    txHashes: [],
  };
}

export function runState(): SupervisorRunState {
  return {
    classifications: [],
    artifacts: [],
    preflightState: [],
    txCount: 0,
    latestPublicState: undefined,
  };
}

export function textWriter(): { text: string; write: (chunk: string) => true } {
  return {
    text: "",
    write(chunk): true {
      this.text += chunk;
      return true;
    },
  };
}

export class PipeChild extends ChildProcess {
  public override stdout = new Readable({ read: noopVoid });
  public override stderr = new Readable({ read: noopVoid });

  public override kill(): boolean {
    return true;
  }
}

export function sparseRecords(): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  records.length = 1;
  return records;
}

export function asyncValue(value: number): () => Promise<number> {
  return async () => {
    await Promise.resolve();
    return value;
  };
}

export function supervisorDependencies(): SupervisorDependencies {
  return { actorEntrypoints: TEST_ACTOR_ENTRYPOINTS };
}
