import { minimalProcessEnv } from "@ickb/node-utils";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import {
  parseArgs,
  prepareOutputDirectory,
  resolvePlan,
  main as runSupervisorMain,
} from "../../../../src/supervisor/index.ts";
import {
  BOT_DECISION_SKIPPED,
  botEvent,
  emptyActions,
  fakeChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  SCENARIO_FLAG,
  spawnFixture,
  TARGET_OUTCOME_FLAG,
} from "../../support/supervisor/index.ts";
import { supervisorDependencies, supervisorPlan, textWriter } from "./support.ts";

const { join } = path;
const CHUNK_DIRECTORY = "chunk-0001";

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
  const root = await mkdtemp(join(tmpdir(), "ickb-supervisor-cli-"));
  const outDir = join(root, "validation", "cli", "chunks", CHUNK_DIRECTORY, "run-0001");
  await expect(
    runSupervisorMain(
      ["--out-dir", outDir, SCENARIO_FLAG, "bot-only"],
      {
        ...supervisorDependencies(),
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
      },
      { stdout, stderr },
    ),
  ).resolves.toBe(0);
  expect(stdout.text).toContain(`live supervisor artifacts: ${outDir}`);
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
  const root = await mkdtemp(join(tmpdir(), "ickb-supervisor-signal-"));
  const outDir = join(root, "validation", "cli", "chunks", CHUNK_DIRECTORY, "run-0001");
  await expect(
    runSupervisorMain(
      ["--out-dir", outDir],
      {
        ...supervisorDependencies(),
        spawnSyncCommand: ignoredChecker(true),
        processOn: (signal, handler) => {
          if (signal === "SIGINT") {
            handler();
          }
        },
        processOff: (signal) => {
          removedSignals.push(signal);
        },
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

  const defaultOutputRoot = await mkdtemp(join(tmpdir(), "ickb-supervisor-real-output-"));
  const outputPlan = supervisorPlan({
    rootDir: defaultOutputRoot,
    outDir: join(defaultOutputRoot, "run"),
  });
  await prepareOutputDirectory(outputPlan);
  await expect(prepareOutputDirectory(outputPlan)).rejects.toThrow(
    "Output directory already exists",
  );

  const externalRoot = await mkdtemp(join(tmpdir(), "ickb-supervisor-external-"));
  await prepareOutputDirectory(
    supervisorPlan({
      rootDir: defaultOutputRoot,
      outDir: join(
        externalRoot,
        "validation",
        "run",
        "chunks",
        CHUNK_DIRECTORY,
        "run-0001",
      ),
    }),
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
  const symlinkRoot = await mkdtemp(join(tmpdir(), "ickb-supervisor-symlink-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "ickb-supervisor-target-"));
  await mkdir(join(symlinkRoot, "log"));
  await symlink(targetRoot, join(symlinkRoot, "log", "linked"));
  await expect(
    prepareOutputDirectory(
      supervisorPlan({
        rootDir: symlinkRoot,
        outDir: join(symlinkRoot, "log", "linked", "run"),
      }),
    ),
  ).rejects.toThrow("symlinked path");
});
