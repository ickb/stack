import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import {
  appendSupervisorEvent,
  prepareOutputDirectory,
  runCommand,
  writeCommandArtifacts,
  writeJsonArtifact,
} from "../../../../src/supervisor/index.ts";
import {
  captureWrites,
  missingStat,
  mkdirFixture,
  spawnFixture,
} from "../../support/supervisor/index.ts";
import {
  PipeChild,
  commandResult,
  commandSpec,
  errno,
  supervisorPlan,
} from "./support.ts";

const { join } = path;
const ALREADY_ARTIFACT = "log/live-supervisor/run/already.json";

it("covers command runner fallback, errors, duplicate finish, and direct signal paths", async () => {
  const errorChild = new PipeChild();
  await expect(
    runCommand(commandSpec(), {
      spawnCommand: spawnFixture(() => {
        queueMicrotask(() => {
          errorChild.emit("error", new Error("spawn boom"));
          errorChild.emit("close", 0, null);
        });
        return errorChild;
      }),
    }),
  ).resolves.toMatchObject({ spawnError: "spawn boom" });
  const textErrorChild = new PipeChild();
  await expect(
    runCommand(commandSpec(), {
      spawnCommand: spawnFixture(() => {
        queueMicrotask(() => {
          Reflect.apply(textErrorChild.emit.bind(textErrorChild), textErrorChild, [
            "error",
            "spawn text",
          ]);
          textErrorChild.emit("close", 1, null);
        });
        return textErrorChild;
      }),
    }),
  ).resolves.toMatchObject({ spawnError: "spawn text" });

  const noPipeChild = new PipeChild();
  Object.defineProperty(noPipeChild, "stdout", { value: null });
  await expect(
    runCommand(commandSpec(), { spawnCommand: spawnFixture(() => noPipeChild) }),
  ).rejects.toThrow("Expected spawned process stdout");

  await expect(
    runCommand({ ...commandSpec(), cwd: process.cwd(), args: ["-e", ""] }, {}),
  ).resolves.toMatchObject({ status: 0 });
});

it("spawns commands with only the explicitly allowed environment", async () => {
  const ambientKey = "SUPERVISOR_RUNTIME_AMBIENT_CANARY";
  const previous = process.env[ambientKey];
  process.env[ambientKey] = "must-not-reach-child";
  let spawnedEnv: NodeJS.ProcessEnv | undefined;
  try {
    const child = new PipeChild();
    const run = runCommand(
      { ...commandSpec(), env: { SUPERVISOR_ALLOWED: "retained" } },
      {
        spawnCommand: spawnFixture((_command, _args, options) => {
          spawnedEnv = options.env;
          queueMicrotask(() => {
            child.emit("close", 0, null);
          });
          return child;
        }),
      },
    );

    await expect(run).resolves.toMatchObject({ status: 0 });
    expect(spawnedEnv).toEqual({ SUPERVISOR_ALLOWED: "retained" });

    const defaultChild = new PipeChild();
    const defaultSpec = commandSpec();
    Reflect.deleteProperty(defaultSpec, "env");
    await runCommand(defaultSpec, {
      spawnCommand: spawnFixture((_command, _args, options) => {
        spawnedEnv = options.env;
        queueMicrotask(() => {
          defaultChild.emit("close", 0, null);
        });
        return defaultChild;
      }),
    });
    expect(spawnedEnv).toEqual({});
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, ambientKey);
    } else {
      process.env[ambientKey] = previous;
    }
  }
});

it("covers artifacts, command shapes, output capture, and dry IO defaults", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-supervisor-artifacts-"));
  const outDir = join(tmpRoot, "log", "live-supervisor", "run");
  const plan = supervisorPlan({ rootDir: tmpRoot, outDir });
  const artifacts = [ALREADY_ARTIFACT];
  const writes = new Map<string, string>();
  const writeDependencies = captureWrites(writes);
  await prepareOutputDirectory(plan, {});

  await expect(
    writeCommandArtifacts(
      plan,
      1,
      "shape",
      commandResult("tester", "text", { args: [plan.testerConfigPath] }),
      writeDependencies,
    ),
  ).resolves.toEqual([
    "log/live-supervisor/run/cycle-0001-shape.stdout.ndjson",
    "log/live-supervisor/run/cycle-0001-shape.stderr.log",
    "log/live-supervisor/run/cycle-0001-shape.command.json",
  ]);
  expect(writes.get(join(outDir, "cycle-0001-shape.command.json"))).toContain(
    "<tester-config-path>",
  );
  await writeCommandArtifacts(
    plan,
    1,
    "shell",
    commandResult("bot", "text", { command: "sh" }),
    writeDependencies,
  );
  expect(writes.get(join(outDir, "cycle-0001-shell.command.json"))).toContain('"sh"');
  await expect(
    writeJsonArtifact(plan, "already.json", { value: 1n }, artifacts, writeDependencies),
  ).resolves.toBe(ALREADY_ARTIFACT);
  expect(artifacts).toEqual([ALREADY_ARTIFACT]);
  await appendSupervisorEvent(plan, { type: "default" }, writeDependencies);
  await writeCommandArtifacts(plan, 2, "default", commandResult("bot", "text"), {});
  await writeJsonArtifact(plan, "default.json", { ok: true }, [], {});
  await appendSupervisorEvent(plan, { type: "default-fs" }, {});

  await expect(
    prepareOutputDirectory(
      supervisorPlan({ rootDir: tmpRoot, outDir: join(outDir, "mkdir-error") }),
      {
        mkdir: mkdirFixture((targetPath) => {
          if (targetPath === join(outDir, "mkdir-error")) {
            throw errno("permission", "EACCES");
          }
        }),
        lstat: missingStat,
      },
    ),
  ).rejects.toThrow("permission");
});
