import { describe, expect, it } from "vitest";
import { parseArgs, resolvePlan, supervise } from "../../../../src/supervisor/index.ts";
import {
  BOT_DECISION_SKIPPED,
  BOT_ENTRYPOINT,
  DIRECTORY_STATS,
  MAX_CYCLES_FLAG,
  SCENARIO_FLAG,
  SUPERVISOR_CLI_SUITE,
  SYMBOLIC_LINK_STATS,
  TEST_ACTOR_ENTRYPOINTS,
  botEvent,
  eexist,
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
  realpathEscapesText,
  realpathFixture,
  recursiveOption,
  spawnFixture,
  spawnSyncFixture,
} from "../../support/supervisor/index.ts";

describe(SUPERVISOR_CLI_SUITE, () => {
  it("refuses to reuse an existing output directory", async () => {
    const args = parseArgs(["--dry-run", "--out-dir", "log/live-supervisor/existing"]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: ignoredChecker(true),
    });

    await expect(
      supervise(args, plan, {
        actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
        mkdir: async (path) => {
          if (pathToString(path) === "/repo/log/live-supervisor/existing") {
            throw eexist();
          }
          await Promise.resolve();
        },
      }),
    ).rejects.toThrow("Output directory already exists: log/live-supervisor/existing");
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("creates only parent directories recursively before reserving a fresh output directory", async () => {
    const args = parseArgs(["--dry-run", "--out-dir", "log/live-supervisor/fresh"]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: ignoredChecker(true),
    });
    const mkdirs: Array<{ path: string; recursive?: boolean }> = [];

    await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      lstat: missingStat,
      realpath: realpathFixture((path) => pathToString(path)),
      mkdir: mkdirFixture((path, options) => {
        mkdirs.push({
          path: pathToString(path),
          recursive: recursiveOption(options),
        });
      }),
      writeFile: noopAsync,
      appendFile: noopAsync,
    });

    expect(mkdirs).toContainEqual({
      path: "/repo/log/live-supervisor",
      recursive: true,
    });
    expect(mkdirs).toContainEqual({
      path: "/repo/log/live-supervisor/fresh",
      recursive: undefined,
    });
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("refuses output directories created after ancestor checks", async () => {
    const args = parseArgs(["--dry-run", "--out-dir", "log/live-supervisor/raced"]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: ignoredChecker(true),
    });

    await expect(
      supervise(args, plan, {
        actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
        lstat: missingStat,
        mkdir: async (path) => {
          if (pathToString(path) === "/repo/log/live-supervisor/raced") {
            throw eexist();
          }
          await Promise.resolve();
        },
        writeFile: () => {
          throw new Error("should not write artifacts after raced output directory");
        },
        appendFile: () => {
          throw new Error("should not write events after raced output directory");
        },
      }),
    ).rejects.toThrow("Output directory already exists: log/live-supervisor/raced");
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("refuses symlinked supervisor artifact parents", async () => {
    const args = parseArgs([
      "--dry-run",
      "--out-dir",
      "log/live-supervisor/symlink-parent",
    ]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: ignoredChecker(true),
    });

    await expect(
      supervise(args, plan, {
        actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
        lstat: lstatFixture((path) => {
          if (pathToString(path) === "/repo/log") {
            return SYMBOLIC_LINK_STATS;
          }
          return DIRECTORY_STATS;
        }),
        stat: missingStat,
        mkdir: noopAsync,
      }),
    ).rejects.toThrow(
      "Refusing to write supervisor artifacts through symlinked path: log",
    );
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("refuses real supervisor artifact paths outside the repo", async () => {
    const args = parseArgs(["--dry-run", "--out-dir", "log/live-supervisor/escaped"]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: ignoredChecker(true),
    });

    await expect(
      supervise(args, plan, {
        actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
        stat: missingStat,
        mkdir: noopAsync,
        realpath: realpathFixture(realpathEscapesText),
      }),
    ).rejects.toThrow("Supervisor output directory must stay inside the repo");
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
      const plan = resolvePlan(args, "/repo", {
        spawnSyncCommand: ignoredChecker(true),
      });

      await supervise(args, plan, {
        actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
        skipBuiltRuntimeCheck: true,
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
        stat: missingStat,
        mkdir: noopAsync,
        appendFile: noopAsync,
        writeFile: noopAsync,
      });

      const preflight = spawned.find((item) => isPreflightCommand(item.args));
      const actor = spawned.find((item) => item.args[0] === BOT_ENTRYPOINT);
      expect(preflight?.env).not.toHaveProperty("PRIVATE_KEY");
      expect(preflight?.env).not.toHaveProperty("COWORKER_BUILD");
      expect(preflight?.env).not.toHaveProperty("NODE_OPTIONS");
      expect(preflight?.env).toMatchObject({ INIT_CWD: "/repo" });
      expect(actor?.env).toMatchObject({
        BOT_CONFIG_FILE: "/repo/config/bot-testnet.json",
        INIT_CWD: "/repo",
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
