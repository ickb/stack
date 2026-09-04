import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs, resolvePlan, supervise } from "../../../../src/supervisor/index.ts";
import {
  BOT_DECISION_SKIPPED,
  BOT_ENTRYPOINT,
  MAX_CYCLES_FLAG,
  SCENARIO_FLAG,
  SUPERVISOR_CLI_SUITE,
  TEST_ACTOR_ENTRYPOINTS,
  botEvent,
  emptyActions,
  fakeChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  resolveTestPlan,
  spawnFixture,
  spawnSyncFixture,
} from "../../support/supervisor/index.ts";

const { join } = path;

describe(SUPERVISOR_CLI_SUITE, () => {
  it("refuses to reuse an existing output directory", async () => {
    const args = parseArgs(["--out-dir", "log/live-supervisor/existing"]);
    const plan = resolveTestPlan(args, { spawnSyncCommand: ignoredChecker(true) });
    await mkdir(plan.outDir, { recursive: true });

    await expect(
      supervise(args, plan, { actorEntrypoints: TEST_ACTOR_ENTRYPOINTS }),
    ).rejects.toThrow("Output directory already exists: log/live-supervisor/existing");
  });

  it("refuses symlinked supervisor artifact parents", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "ickb-supervisor-symlink-root-"));
    const targetDir = await mkdtemp(join(tmpdir(), "ickb-supervisor-symlink-target-"));
    await symlink(targetDir, join(rootDir, "log"));
    const args = parseArgs(["--out-dir", "log/live-supervisor/symlink-parent"]);
    const plan = resolvePlan(args, rootDir, {
      spawnSyncCommand: ignoredChecker(true),
    });

    await expect(
      supervise(args, plan, { actorEntrypoints: TEST_ACTOR_ENTRYPOINTS }),
    ).rejects.toThrow(
      "Refusing to write supervisor artifacts through symlinked path: log",
    );
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("spawns live actors with an allowlisted environment", async () => {
    const originalPrivateKey = process.env["PRIVATE_KEY"];
    process.env["PRIVATE_KEY"] = "operator-secret";
    try {
      const spawned: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
      const args = parseArgs([
        "--out-dir",
        "log/live-supervisor/env-test",
        SCENARIO_FLAG,
        "bot-only",
        MAX_CYCLES_FLAG,
        "1",
      ]);
      const plan = resolveTestPlan(args, { spawnSyncCommand: ignoredChecker(true) });

      await supervise(args, plan, {
        actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
        spawnCommand: spawnFixture((_command, commandArgs, options) => {
          spawned.push({ args: commandArgs, env: options.env });
          return isPreflightCommand(commandArgs)
            ? fakeSuccessfulPreflightChild()
            : fakeChild(
                JSON.stringify(
                  botEvent(BOT_DECISION_SKIPPED, {
                    reason: "no_actions",
                    actions: emptyActions(),
                  }),
                ),
              );
        }),
        spawnSyncCommand: ignoredChecker(true),
      });

      const preflight = spawned.find((item) => isPreflightCommand(item.args));
      const actor = spawned.find((item) => item.args[0] === BOT_ENTRYPOINT);
      expect(preflight?.env).not.toHaveProperty("PRIVATE_KEY");
      expect(preflight?.env).not.toHaveProperty("COWORKER_BUILD");
      expect(preflight?.env).not.toHaveProperty("NODE_OPTIONS");
      expect(preflight?.env).toMatchObject({ INIT_CWD: plan.rootDir });
      expect(actor?.env).toMatchObject({
        BOT_CONFIG_FILE: plan.botConfigPath,
        INIT_CWD: plan.rootDir,
      });
      expect(actor?.env).not.toHaveProperty("PRIVATE_KEY");
      expect(actor?.env).not.toHaveProperty("COWORKER_BUILD");
      expect(actor?.env).not.toHaveProperty("NODE_OPTIONS");
    } finally {
      if (originalPrivateKey === undefined) {
        delete process.env["PRIVATE_KEY"];
      } else {
        process.env["PRIVATE_KEY"] = originalPrivateKey;
      }
    }
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("runs git ignore guards with an allowlisted environment", () => {
    const originalPrivateKey = process.env["PRIVATE_KEY"];
    process.env["PRIVATE_KEY"] = "operator-secret";
    try {
      const seen: Array<{
        command: string;
        args?: readonly string[];
        env?: NodeJS.ProcessEnv;
      }> = [];
      const args = parseArgs(["--out-dir", "log/live-supervisor/env-guard"]);

      resolvePlan(args, "/repo", {
        spawnSyncCommand: spawnSyncFixture((commandArgs, command, options) => {
          seen.push({ command, args: commandArgs, env: options?.env });
          return 0;
        }),
      });

      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen.map((entry) => entry.command))).toEqual(new Set(["git"]));
      for (const entry of seen) {
        expect(entry.env).not.toHaveProperty("PRIVATE_KEY");
        expect(entry.env).not.toHaveProperty("NODE_OPTIONS");
      }
    } finally {
      if (originalPrivateKey === undefined) {
        delete process.env["PRIVATE_KEY"];
      } else {
        process.env["PRIVATE_KEY"] = originalPrivateKey;
      }
    }
  });
});
