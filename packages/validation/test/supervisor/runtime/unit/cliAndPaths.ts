import { minimalProcessEnv } from "@ickb/node-utils";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import {
  assertBuiltRuntime,
  parseArgs,
  prepareOutputDirectory,
  resolvePlan,
  main as runSupervisorMain,
} from "../../../../src/supervisor/index.ts";
import {
  BOT_DECISION_SKIPPED,
  botEvent,
  captureWrites,
  emptyActions,
  fakeChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  lstatFixture,
  missingStat,
  mkdirFixture,
  noopAsync,
  pathToString,
  realpathFixture,
  SCENARIO_FLAG,
  spawnFixture,
  SYMBOLIC_LINK_STATS,
  TARGET_OUTCOME_FLAG,
} from "../../support/supervisor/index.ts";
import { supervisorDependencies, supervisorPlan, textWriter } from "./support.ts";

const { join } = path;

it("covers CLI parsing errors and help", async () => {
  const sparseArgv = Array.from<string>({ length: 1 });
  expect(() => parseArgs(sparseArgv)).toThrow("Missing argument at index 0");
  expect(() => parseArgs(["--unknown"])).toThrow("Unknown argument");
  expect(() => parseArgs([TARGET_OUTCOME_FLAG, "not-an-outcome"])).toThrow(
    "unknown outcome",
  );
  expect(() => parseArgs([SCENARIO_FLAG, "not-a-scenario"])).toThrow(
    "Invalid --scenario",
  );
  expect(() => parseArgs(["--out-dir"])).toThrow("Missing value");
  expect(() => parseArgs(["--max-cycles", "0"])).toThrow("positive integer");
  expect(parseArgs(["--", "-h"]).help).toBe(true);
  expect(parseArgs(["-h"]).help).toBe(true);
  expect(parseArgs(["--help"]).help).toBe(true);

  const stdout = textWriter();
  const stderr = textWriter();
  await expect(
    runSupervisorMain(["--bad"], supervisorDependencies(), { stdout, stderr }),
  ).resolves.toBe(1);
  expect(stderr.text).toContain("Unknown argument");

  stdout.text = "";
  await expect(
    runSupervisorMain(["--help"], supervisorDependencies(), { stdout, stderr }),
  ).resolves.toBe(0);
  expect(stdout.text).toContain("Usage:");
});

it("reports the artifact directory after a completed run", async () => {
  const stdout = textWriter();
  const stderr = textWriter();
  await expect(
    runSupervisorMain(
      ["--out-dir", "log/live-supervisor/cli-success", SCENARIO_FLAG, "bot-only"],
      {
        ...supervisorDependencies(),
        skipBuiltRuntimeCheck: true,
        spawnCommand: spawnFixture((_command: string, commandArgs: string[]) =>
          isPreflightCommand(commandArgs)
            ? fakeSuccessfulPreflightChild()
            : fakeChild(
                JSON.stringify(
                  botEvent(BOT_DECISION_SKIPPED, {
                    reason: "no_actions",
                    actions: emptyActions(),
                  }),
                ),
              ),
        ),
        spawnSyncCommand: ignoredChecker(true),
        mkdir: noopAsync,
        lstat: missingStat,
        stat: missingStat,
        realpath: realpathFixture((targetPath) => pathToString(targetPath)),
        ...captureWrites(new Map()),
      },
      { stdout, stderr },
    ),
  ).resolves.toBe(0);
  expect(stdout.text).toContain(
    "live supervisor artifacts: log/live-supervisor/cli-success",
  );
});

it("covers resolved CLI failures and forwarded signals", async () => {
  const stdout = textWriter();
  const stderr = textWriter();
  await expect(
    runSupervisorMain(["--out-dir", "/outside"], supervisorDependencies(), {
      stdout,
      stderr,
    }),
  ).resolves.toBe(1);
  expect(stderr.text).toContain("Live supervisor failed");

  const removedSignals: NodeJS.Signals[] = [];
  await expect(
    runSupervisorMain(
      ["--out-dir", "log/live-supervisor/cli-signal"],
      {
        ...supervisorDependencies(),
        skipBuiltRuntimeCheck: true,
        spawnSyncCommand: ignoredChecker(true),
        mkdir: noopAsync,
        lstat: missingStat,
        realpath: realpathFixture((targetPath) => pathToString(targetPath)),
        processOn: (signal, handler) => {
          if (signal === "SIGINT") {
            handler();
          }
        },
        processOff: (signal) => {
          removedSignals.push(signal);
        },
        ...captureWrites(new Map()),
      },
      { stdout, stderr },
    ),
  ).resolves.toBe(130);
  expect(removedSignals).toEqual(["SIGINT", "SIGTERM"]);
});

it("covers supervisor path and output directory guards", async () => {
  expect(
    resolvePlan(parseArgs([]), "/repo", {
      spawnSyncCommand: ignoredChecker(true),
    }).relativeOutDir,
  ).toContain("log/live-supervisor/");
  expect(
    resolvePlan(parseArgs(["--out-dir", "log/live-supervisor"])).relativeOutDir,
  ).toBe("log/live-supervisor");
  expect(() => resolvePlan({ ...parseArgs([]), outDir: "" }, "/repo")).toThrow(
    "must not be empty",
  );
  expect(() =>
    resolvePlan({ ...parseArgs([]), botConfigPath: "/outside/config.json" }, "/repo"),
  ).toThrow("must stay inside");
  expect(minimalProcessEnv({ PATH: "/bin" })).toEqual({ PATH: "/bin" });

  const plan = supervisorPlan({ outDir: "/repo/log/live-supervisor/output" });
  const defaultOutputRoot = await mkdtemp(join(tmpdir(), "ickb-supervisor-real-output-"));
  await prepareOutputDirectory(
    supervisorPlan({
      rootDir: defaultOutputRoot,
      outDir: join(defaultOutputRoot, "run"),
    }),
    {},
  );
  await expect(
    prepareOutputDirectory(plan, {
      mkdir: mkdirFixture(() => {
        throw new Error("mkdir failed");
      }),
      lstat: missingStat,
    }),
  ).rejects.toThrow("mkdir failed");
  await expect(
    prepareOutputDirectory(plan, {
      mkdir: noopAsync,
      lstat: missingStat,
      realpath: realpathFixture(() => {
        throw new Error("realpath failed");
      }),
    }),
  ).rejects.toThrow("realpath failed");
  expect(() => {
    assertBuiltRuntime(plan, {});
  }).toThrow("Missing built live preflight script");
  expect(() => {
    assertBuiltRuntime(plan, { existsSync: () => true });
  }).not.toThrow();

  await prepareOutputDirectory(
    supervisorPlan({ outDir: "/external/validation/run/chunks/chunk-0001/run-0001" }),
    {
      lstat: missingStat,
      mkdir: noopAsync,
      realpath: realpathFixture((targetPath) => pathToString(targetPath)),
    },
  );
  expect(() =>
    resolvePlan({
      ...parseArgs([]),
      outDir: "/external/validation/run/chunks/chunk-0001/not-run",
    }),
  ).toThrow("Supervisor output directory must be under");
  expect(() => resolvePlan({ ...parseArgs([]), outDir: "validation/run" })).toThrow(
    "Supervisor output directory must be under",
  );
  await expect(
    prepareOutputDirectory(plan, {
      lstat: lstatFixture(() => SYMBOLIC_LINK_STATS),
    }),
  ).rejects.toThrow("symlinked path");
});
