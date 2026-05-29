import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  appendBoundedOutput,
  boundedOutputText,
  chooseScenario,
  classifyActorResult,
  createBoundedOutputCapture,
  createCoverageLedger,
  parseArgs,
  parseJsonEvidence,
  parsePreflightEvidence,
  recordScenarioAttempt,
  recordOutcome,
  resolvePlan,
  supervise,
  usage,
  type CommandResult,
} from "./index.js";

describe("supervisor CLI", () => {
  it("parses bounded live supervisor arguments", () => {
    const args = parseArgs([
      "--bot-config", "config/bot-testnet.json",
      "--tester-config", "config/tester-testnet.json",
      "--max-cycles", "3",
      "--stop-after-tx-count", "2",
      "--scenario", "tester-fresh-skip-two-pass",
      "--tester-scenario", "all-ckb-limit-order",
      "--tester-fee", "1000",
      "--tester-fee-base", "100000",
      "--target-outcome", "bot_match_committed",
      "--target-outcome", "bot_no_action_skip",
    ]);

    expect(args.botConfigPath).toBe("config/bot-testnet.json");
    expect(args.testerConfigPath).toBe("config/tester-testnet.json");
    expect(args.maxCycles).toBe(3);
    expect(args.stopAfterTxCount).toBe(2);
    expect(args.scenario).toBe("tester-fresh-skip-two-pass");
    expect(args.testerScenario).toBe("all-ckb-limit-order");
    expect(args.testerScenarioExplicit).toBe(true);
    expect(args.testerFee).toBe("1000");
    expect(args.testerFeeBase).toBe("100000");
    expect(args.testerFeeExplicit).toBe(true);
    expect(args.testerFeeBaseExplicit).toBe(true);
    expect(args.targetOutcomes).toEqual(["bot_match_committed", "bot_no_action_skip"]);
    expect(usage()).toContain("--bot-config");
    expect(usage()).toContain("sdk-conversion");
    expect(usage()).toContain("tester-fresh-skip-two-pass");
  });

  it("parses the SDK conversion tester scenario", () => {
    const args = parseArgs(["--tester-scenario", "sdk-conversion"]);

    expect(args.testerScenario).toBe("sdk-conversion");
    expect(args.testerScenarioExplicit).toBe(true);
    expect(parseArgs(["--tester-scenario", "two-ckb-to-ickb-limit-orders"]).testerScenario).toBe(
      "two-ckb-to-ickb-limit-orders",
    );
    expect(parseArgs(["--tester-scenario", "two-ickb-to-ckb-limit-orders"]).testerScenario).toBe(
      "two-ickb-to-ckb-limit-orders",
    );
    expect(parseArgs(["--tester-scenario", "bounded-ickb-to-ckb-limit-order"]).testerScenario).toBe(
      "bounded-ickb-to-ckb-limit-order",
    );
    expect(parseArgs(["--tester-scenario", "mixed-direction-limit-orders"]).testerScenario).toBe(
      "mixed-direction-limit-orders",
    );
    expect(parseArgs(["--tester-scenario", "multi-order-limit-orders"]).testerScenario).toBe(
      "multi-order-limit-orders",
    );
    expect(() => parseArgs(["--tester-scenario", "interface-like"])).toThrow("Invalid --tester-scenario");
  });

  it("rejects malformed tester fee controls", () => {
    expect(() => parseArgs(["--tester-fee", "1.5"])).toThrow("Invalid --tester-fee");
    expect(() => parseArgs(["--tester-fee-base", "-1"])).toThrow("Invalid --tester-fee-base");
  });

  it("rejects unsafe integer bounds without numeric rounding", () => {
    expect(parseArgs(["--max-cycles", String(Number.MAX_SAFE_INTEGER)]).maxCycles).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parseArgs(["--max-cycles", "9007199254740992"])).toThrow(
      "Invalid --max-cycles: expected a safe integer",
    );
    expect(() => parseArgs(["--command-timeout-seconds", "9007199254740993"])).toThrow(
      "Invalid --command-timeout-seconds: expected a safe integer",
    );
  });

  it("defaults bare supervisor runs to deterministic live configs", () => {
    const args = parseArgs([]);

    expect(args.botConfigPath).toBe("config/bot-testnet.json");
    expect(args.testerConfigPath).toBe("config/tester-testnet.json");
    expect(args.testerScenario).toBe("auto");
    expect(args.testerScenarioExplicit).toBe(false);
    expect(args.testerFee).toBe("1");
    expect(args.testerFeeBase).toBe("100000");
    expect(args.testerFeeExplicit).toBe(false);
    expect(args.testerFeeBaseExplicit).toBe(false);
  });

  it("refuses non-ignored output paths", () => {
    const args = parseArgs(["--dry-run", "--out-dir", "not-ignored"]);

    expect(() => resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(false) })).toThrow(
      "Supervisor output directory must be under logs/live-supervisor/ or a validation session run directory",
    );
  });

  it("refuses ignored output paths outside the supervisor artifact root", () => {
    const args = parseArgs(["--dry-run", "--out-dir", "config/supervisor"]);

    expect(() => resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) })).toThrow(
      "Supervisor output directory must be under logs/live-supervisor/ or a validation session run directory",
    );
  });

  it("resolves ignored dry-run artifact paths without configs", () => {
    const args = parseArgs(["--dry-run", "--out-dir", "logs/live-supervisor/test"]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    expect(plan.relativeOutDir).toBe("logs/live-supervisor/test");
    expect(plan.botConfigPath).toBeUndefined();
    expect(plan.testerConfigPath).toBeUndefined();
  });

  it("accepts dynamic validation session artifact paths", () => {
    const args = parseArgs(["--dry-run", "--out-dir", "log/validation/dynamic-test/chunks/chunk-0001/run-0001"]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set(["log/validation/dynamic-test/chunks/chunk-0001/run-0001"])) });

    expect(plan.relativeOutDir).toBe("log/validation/dynamic-test/chunks/chunk-0001/run-0001");
    expect(plan.botConfigPath).toBeUndefined();
    expect(plan.testerConfigPath).toBeUndefined();
  });

  it("rejects validation roots outside run artifact directories", () => {
    const args = parseArgs(["--dry-run", "--out-dir", "log/validation/dynamic-test"]);

    expect(() => resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) })).toThrow(
      "Supervisor output directory must be under logs/live-supervisor/ or a validation session run directory",
    );
  });

  it("rejects validation run artifact directory descendants", () => {
    const args = parseArgs(["--dry-run", "--out-dir", "log/validation/dynamic-test/chunks/chunk-0001/run-0001/extra"]);

    expect(() => resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) })).toThrow(
      "Supervisor output directory must be under logs/live-supervisor/ or a validation session run directory",
    );
  });

  it("accepts explicit validation session roots outside the repo", () => {
    const args = parseArgs(["--dry-run", "--out-dir", "/var/tmp/ickb-log/validation/dynamic-test/chunks/chunk-0001/run-0001"]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(false) });

    expect(plan.relativeOutDir).toBe("/var/tmp/ickb-log/validation/dynamic-test/chunks/chunk-0001/run-0001");
    expect(plan.outDir).toBe("/var/tmp/ickb-log/validation/dynamic-test/chunks/chunk-0001/run-0001");
  });

  it("refuses symlinked explicit validation parents outside the repo", async () => {
    const args = parseArgs(["--dry-run", "--out-dir", "/var/tmp/ickb-log/validation/dynamic-test/chunks/chunk-0001/run-0001"]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(false) });

    await expect(supervise(args, plan, {
      lstat: (path) => Promise.resolve({ isSymbolicLink: () => pathToString(path) === "/var/tmp/ickb-log/validation" } as never),
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
    })).rejects.toThrow("Refusing to write supervisor artifacts through symlinked path: /var/tmp/ickb-log/validation");
  });

  it("resolves default ignored live config paths", () => {
    const plan = resolvePlan(parseArgs(["--out-dir", "logs/live-supervisor/test"]), "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
      "logs/live-supervisor/test",
      "config/bot-testnet.json",
      "config/tester-testnet.json",
    ])) });

    expect(plan.botConfigPath).toBe("/repo/config/bot-testnet.json");
    expect(plan.testerConfigPath).toBe("/repo/config/tester-testnet.json");
  });

  it("refuses to reuse an existing output directory", async () => {
    const args = parseArgs(["--dry-run", "--out-dir", "logs/live-supervisor/existing"]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    await expect(supervise(args, plan, {
      stat: () => Promise.resolve({} as never),
      mkdir: () => Promise.resolve(undefined),
    })).rejects.toThrow("Output directory already exists: logs/live-supervisor/existing");
  });

  it("refuses symlinked supervisor artifact parents", async () => {
    const args = parseArgs(["--dry-run", "--out-dir", "logs/live-supervisor/symlink-parent"]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    await expect(supervise(args, plan, {
      lstat: (path) => {
        if (pathToString(path) === "/repo/logs") {
          return Promise.resolve({ isSymbolicLink: () => true } as never);
        }
        return Promise.resolve({ isSymbolicLink: () => false } as never);
      },
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
    })).rejects.toThrow("Refusing to write supervisor artifacts through symlinked path: logs");
  });

  it("refuses real supervisor artifact paths outside the repo", async () => {
    const args = parseArgs(["--dry-run", "--out-dir", "logs/live-supervisor/escaped"]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    await expect(supervise(args, plan, {
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      realpath: (path) => Promise.resolve(pathToString(path) === "/repo" ? "/repo" : "/tmp/escaped"),
    })).rejects.toThrow("Supervisor output directory must stay inside the repo");
  });

  it("spawns live actors with an allowlisted environment", async () => {
    const originalPrivateKey = process.env.PRIVATE_KEY;
    process.env.PRIVATE_KEY = "operator-secret";
    try {
      const spawned: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
      const args = parseArgs([
        "--out-dir", "logs/live-supervisor/env-test",
        "--scenario", "bot-only",
        "--max-cycles", "1",
      ]);
      const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

      await supervise(args, plan, {
        skipBuiltRuntimeCheck: true,
        spawnCommand: ((_command: string, commandArgs: string[], options: { env?: NodeJS.ProcessEnv }) => {
          spawned.push({ args: commandArgs, env: options.env });
          return isPreflightCommand(commandArgs)
            ? fakeSuccessfulPreflightChild()
            : fakeChild(JSON.stringify(botEvent("bot.decision.skipped", {
              reason: "no_actions",
              actions: emptyActions(),
            })));
        }) as never,
        spawnSyncCommand: ignoredChecker(true) as never,
        stat: missingStat,
        mkdir: () => Promise.resolve(undefined),
        appendFile: () => Promise.resolve(),
        writeFile: () => Promise.resolve(),
      });

      const preflight = spawned.find((item) => isPreflightCommand(item.args));
      const actor = spawned.find((item) => item.args[0] === "apps/bot/dist/index.js");
      expect(preflight?.env).not.toHaveProperty("PRIVATE_KEY");
      expect(preflight?.env).not.toHaveProperty("COWORKER_BUILD");
      expect(preflight?.env).toMatchObject({ INIT_CWD: "/repo", NODE_OPTIONS: "--disable-warning=DEP0040" });
      expect(actor?.env).toMatchObject({ BOT_CONFIG_FILE: "/repo/config/bot-testnet.json", INIT_CWD: "/repo", NODE_OPTIONS: "--disable-warning=DEP0040" });
      expect(actor?.env).not.toHaveProperty("PRIVATE_KEY");
      expect(actor?.env).not.toHaveProperty("COWORKER_BUILD");
    } finally {
      if (originalPrivateKey === undefined) {
        delete process.env.PRIVATE_KEY;
      } else {
        process.env.PRIVATE_KEY = originalPrivateKey;
      }
    }
  });

  it("steers tester conversion coverage to the SDK conversion builder", async () => {
    const spawned: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/conversion-env-test",
      "--target-outcome", "tester_conversion_created",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[], options: { env?: NodeJS.ProcessEnv }) => {
        spawned.push({ args: commandArgs, env: options.env });
        return isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(JSON.stringify({
            startTime: "now",
            actions: { conversion: { kind: "direct" }, cancelledOrders: 0 },
            txHash: txHash("15"),
            ElapsedSeconds: 1,
          }));
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: () => Promise.resolve(),
      writeFile: () => Promise.resolve(),
    });

    const tester = spawned.find((item) => item.args[0] === "apps/tester/dist/index.js");
    expect(exitCode).toBe(0);
    expect(tester?.env).toMatchObject({ TESTER_SCENARIO: "sdk-conversion" });
  });

  it("preserves explicit tester scenario over conversion target steering", async () => {
    const spawned: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/explicit-tester-env-test",
      "--target-outcome", "tester_conversion_created",
      "--tester-scenario", "ickb-to-ckb-limit-order",
      "--stop-after-tx-count", "1",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[], options: { env?: NodeJS.ProcessEnv }) => {
        spawned.push({ args: commandArgs, env: options.env });
        return isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(JSON.stringify({
            startTime: "now",
            actions: {
              testerScenario: "ickb-to-ckb-limit-order",
              newOrder: { giveIckb: "10", takeCkb: "9", fee: "0.1" },
              cancelledOrders: 0,
            },
            txHash: txHash("16"),
            ElapsedSeconds: 1,
          }));
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: () => Promise.resolve(),
      writeFile: () => Promise.resolve(),
    });

    const tester = spawned.find((item) => item.args[0] === "apps/tester/dist/index.js");
    expect(exitCode).toBe(0);
    expect(tester?.env).toMatchObject({ TESTER_SCENARIO: "ickb-to-ckb-limit-order" });
  });

  it("preserves explicit tester auto scenario over conversion target steering", async () => {
    const spawned: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/explicit-auto-env-test",
      "--target-outcome", "tester_conversion_created",
      "--tester-scenario", "auto",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[], options: { env?: NodeJS.ProcessEnv }) => {
        spawned.push({ args: commandArgs, env: options.env });
        return isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(JSON.stringify({
            startTime: "now",
            actions: { conversion: { kind: "direct" }, cancelledOrders: 0 },
            txHash: txHash("17"),
            ElapsedSeconds: 1,
          }));
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: () => Promise.resolve(),
      writeFile: () => Promise.resolve(),
    });

    const tester = spawned.find((item) => item.args[0] === "apps/tester/dist/index.js");
    expect(exitCode).toBe(0);
    expect(tester?.env).toMatchObject({ TESTER_SCENARIO: "auto" });
  });

  it("passes tester fee controls only to the tester actor", async () => {
    const spawned: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/tester-fee-env-test",
      "--scenario", "standard-cycle",
      "--tester-fee", "1000",
      "--tester-fee-base", "100000",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[], options: { env?: NodeJS.ProcessEnv }) => {
        spawned.push({ args: commandArgs, env: options.env });
        if (isPreflightCommand(commandArgs)) {
          return fakeSuccessfulPreflightChild();
        }
        return commandArgs[0] === "apps/tester/dist/index.js"
          ? fakeChild(JSON.stringify({
            startTime: "now",
            actions: { newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" }, cancelledOrders: 0 },
            txHash: txHash("18"),
            ElapsedSeconds: 1,
          }))
          : fakeChild(JSON.stringify(botEvent("bot.decision.skipped", {
            reason: "no_actions",
            actions: emptyActions(),
          })));
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: () => Promise.resolve(),
      writeFile: () => Promise.resolve(),
    });

    const tester = spawned.find((item) => item.args[0] === "apps/tester/dist/index.js");
    const bot = spawned.find((item) => item.args[0] === "apps/bot/dist/index.js");
    expect(exitCode).toBe(0);
    expect(tester?.env).toMatchObject({ TESTER_FEE: "1000", TESTER_FEE_BASE: "100000" });
    expect(bot?.env).not.toHaveProperty("TESTER_FEE");
    expect(bot?.env).not.toHaveProperty("TESTER_FEE_BASE");
  });

  it("runs the same tester twice for fresh-skip auto coverage", async () => {
    const spawned: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const writes = new Map<string, string>();
    let testerRuns = 0;
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/two-pass-test",
      "--scenario", "tester-fresh-skip-two-pass",
      "--target-outcome", "tester_order_created",
      "--target-outcome", "tester_fresh_order_skip",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[], options: { env?: NodeJS.ProcessEnv }) => {
        spawned.push({ args: commandArgs, env: options.env });
        if (isPreflightCommand(commandArgs)) {
          return fakeSuccessfulPreflightChild();
        }
        testerRuns += 1;
        return fakeChild(JSON.stringify(testerRuns === 1
          ? {
              startTime: "now",
              actions: {
                requestedTesterScenario: "auto",
                testerScenario: "bounded-ickb-to-ckb-limit-order",
                newOrder: { giveIckb: "20", takeCkb: "18", fee: "0.2" },
                cancelledOrders: 0,
              },
              txHash: txHash("77"),
              ElapsedSeconds: 1,
            }
          : { skip: { reason: "fresh-matchable-order", txHash: txHash("77") } }));
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: () => Promise.resolve(),
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    const testerSpawns = spawned.filter((item) => item.args[0] === "apps/tester/dist/index.js");
    expect(exitCode).toBe(0);
    expect(testerSpawns).toHaveLength(2);
    expect(testerSpawns[0]?.env).toMatchObject({ TESTER_SCENARIO: "auto" });
    expect(testerSpawns[1]?.env).toMatchObject({ TESTER_SCENARIO: "auto" });
    expect(writes.has("/repo/logs/live-supervisor/two-pass-test/cycle-0001-tester-pass-1.stdout.ndjson")).toBe(true);
    expect(writes.has("/repo/logs/live-supervisor/two-pass-test/cycle-0001-tester-pass-2.stdout.ndjson")).toBe(true);
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/two-pass-test/summary.json");
    expect(recordAt(summary["aggregateCounts"], "summary aggregate counts")).toMatchObject({
      tester_order_created: 1,
      tester_fresh_order_skip: 1,
    });
  });

  it("uses tester auto for low-CKB first-pass fresh-skip fundability", async () => {
    const spawned: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    let testerRuns = 0;
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/two-pass-low-ckb-test",
      "--scenario", "tester-fresh-skip-two-pass",
      "--target-outcome", "tester_order_created",
      "--target-outcome", "tester_fresh_order_skip",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[], options: { env?: NodeJS.ProcessEnv }) => {
        spawned.push({ args: commandArgs, env: options.env });
        if (isPreflightCommand(commandArgs)) {
          return commandArgs.includes("tester-pass-1-1")
            ? fakePreflightChild({ ckbAvailable: "2853.99897309", ickbAvailable: "250838.31219989" })
            : fakeSuccessfulPreflightChild();
        }
        testerRuns += 1;
        return fakeChild(JSON.stringify(testerRuns === 1
          ? {
              startTime: "now",
              actions: {
                requestedTesterScenario: "auto",
                testerScenario: "bounded-ickb-to-ckb-limit-order",
                newOrder: { giveIckb: "20", takeCkb: "18", fee: "0.2" },
                cancelledOrders: 0,
              },
              txHash: txHash("78"),
              ElapsedSeconds: 1,
            }
          : { skip: { reason: "fresh-matchable-order", txHash: txHash("78") } }));
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: () => Promise.resolve(),
      writeFile: () => Promise.resolve(),
    });

    const testerSpawns = spawned.filter((item) => item.args[0] === "apps/tester/dist/index.js");
    expect(exitCode).toBe(0);
    expect(testerSpawns).toHaveLength(2);
    expect(testerSpawns[0]?.env).toMatchObject({ TESTER_SCENARIO: "auto" });
    expect(testerSpawns[1]?.env).toMatchObject({ TESTER_SCENARIO: "auto" });
  });

  it("treats tester first-pass fresh-skip reserve misses as classified no-progress", async () => {
    const spawned: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const writes = new Map<string, string>();
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/two-pass-bounded-reserve-test",
      "--scenario", "tester-fresh-skip-two-pass",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[], options: { env?: NodeJS.ProcessEnv }) => {
        spawned.push({ args: commandArgs, env: options.env });
        return isPreflightCommand(commandArgs)
          ? fakePreflightChild({ ckbAvailable: "2100", ickbAvailable: "250838.31219989" })
          : fakeChild(JSON.stringify({ skip: { reason: "post-tx-ckb-reserve" } }));
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: () => Promise.resolve(),
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    const testerSpawns = spawned.filter((item) => item.args[0] === "apps/tester/dist/index.js");
    expect(exitCode).toBe(0);
    expect(testerSpawns[0]?.env).toMatchObject({ TESTER_SCENARIO: "auto" });
    expect([...writes.keys()].some((path) => path.endsWith("incident.json"))).toBe(false);
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/two-pass-bounded-reserve-test/summary.json");
    expect(summary).toMatchObject({ stopped: "max_cycles", skipReasons: ["post-tx-ckb-reserve", "post-tx-ckb-reserve"] });
    expect(recordAt(summary["aggregateCounts"], "summary aggregate counts")).toEqual({ tester_reserve_skip: 2 });
  });

  it("uses auto first-pass fresh-skip stimulus when plain CKB is very low", async () => {
    const spawned: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/two-pass-low-reserve-test",
      "--scenario", "tester-fresh-skip-two-pass",
      "--target-outcome", "tester_order_created",
      "--target-outcome", "tester_fresh_order_skip",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[], options: { env?: NodeJS.ProcessEnv }) => {
        spawned.push({ args: commandArgs, env: options.env });
        return isPreflightCommand(commandArgs)
          ? fakePreflightChild({ ckbAvailable: "1999.99999999", ickbAvailable: "250838.31219989" })
          : fakeChild(JSON.stringify({ skip: { reason: "post-tx-ckb-reserve" } }));
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: () => Promise.resolve(),
      writeFile: () => Promise.resolve(),
    });

    const tester = spawned.find((item) => item.args[0] === "apps/tester/dist/index.js");
    expect(tester?.env).toMatchObject({ TESTER_SCENARIO: "auto" });
  });

  it("uses auto first-pass fresh-skip stimulus when plain CKB is high", async () => {
    const spawned: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    let testerRuns = 0;
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/two-pass-high-ckb-test",
      "--scenario", "tester-fresh-skip-two-pass",
      "--target-outcome", "tester_order_created",
      "--target-outcome", "tester_fresh_order_skip",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[], options: { env?: NodeJS.ProcessEnv }) => {
        spawned.push({ args: commandArgs, env: options.env });
        if (isPreflightCommand(commandArgs)) {
          return commandArgs.includes("tester-pass-1-1")
            ? fakePreflightChild({ ckbAvailable: "3000", ickbAvailable: "250838.31219989" })
            : fakeSuccessfulPreflightChild();
        }
        testerRuns += 1;
        return fakeChild(JSON.stringify(testerRuns === 1
          ? {
              startTime: "now",
              actions: {
                requestedTesterScenario: "auto",
                testerScenario: "bounded-ickb-to-ckb-limit-order",
                newOrder: { giveIckb: "20", takeCkb: "18", fee: "0.2" },
                cancelledOrders: 0,
              },
              txHash: txHash("80"),
              ElapsedSeconds: 1,
            }
          : { skip: { reason: "fresh-matchable-order", txHash: txHash("80") } }));
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: () => Promise.resolve(),
      writeFile: () => Promise.resolve(),
    });

    const testerSpawns = spawned.filter((item) => item.args[0] === "apps/tester/dist/index.js");
    expect(exitCode).toBe(0);
    expect(testerSpawns[0]?.env).toMatchObject({ TESTER_SCENARIO: "auto" });
    expect(testerSpawns[1]?.env).toMatchObject({ TESTER_SCENARIO: "auto" });
  });

  it("preserves explicit tester scenario during fresh-skip pass selection", async () => {
    const spawned: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/two-pass-explicit-test",
      "--scenario", "tester-fresh-skip-two-pass",
      "--tester-scenario", "multi-order-limit-orders",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[], options: { env?: NodeJS.ProcessEnv }) => {
        spawned.push({ args: commandArgs, env: options.env });
        return isPreflightCommand(commandArgs)
          ? fakePreflightChild({ ckbAvailable: "2853.99897309", ickbAvailable: "250838.31219989" })
          : fakeChild(JSON.stringify({
              startTime: "now",
              actions: {
                requestedTesterScenario: "auto",
                testerScenario: "bounded-ickb-to-ckb-limit-order",
                newOrder: { giveIckb: "20", takeCkb: "18", fee: "0.2" },
                cancelledOrders: 0,
              },
              txHash: txHash("79"),
              ElapsedSeconds: 1,
            }));
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: () => Promise.resolve(),
      writeFile: () => Promise.resolve(),
    });

    const tester = spawned.find((item) => item.args[0] === "apps/tester/dist/index.js");
    expect(tester?.env).toMatchObject({ TESTER_SCENARIO: "multi-order-limit-orders" });
  });

  it("refuses live config paths through symlinked parents", async () => {
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/config-symlink-test",
      "--scenario", "bot-only",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    await expect(supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      lstat: (path) => {
        if (pathToString(path) === "/repo/config") {
          return Promise.resolve({ isSymbolicLink: () => true } as never);
        }
        return Promise.resolve({ isSymbolicLink: () => false } as never);
      },
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: () => Promise.resolve(),
      writeFile: () => Promise.resolve(),
    })).rejects.toThrow("Refusing to use bot config path through symlinked path: config");
  });

  it("refuses non-ignored config paths", () => {
    const args = parseArgs([
      "--bot-config", "tracked-bot.json",
      "--tester-config", "config/tester-testnet.json",
      "--out-dir", "logs/live-supervisor/test",
    ]);

    expect(() => resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
      "logs/live-supervisor/test",
      "config/tester-testnet.json",
    ])) })).toThrow("Refusing to use non-ignored Bot config path: tracked-bot.json");
  });

  it("refuses non-ignored default config paths", () => {
    const args = parseArgs(["--out-dir", "logs/live-supervisor/test"]);

    expect(() => resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
      "logs/live-supervisor/test",
      "config/tester-testnet.json",
    ])) })).toThrow("Refusing to use non-ignored Bot config path: config/bot-testnet.json");
  });

  it("requires built runtime outputs before live actor spawn", async () => {
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/missing-build-test",
      "--scenario", "bot-only",
      "--target-outcome", "bot_match_committed",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
      "logs/live-supervisor/missing-build-test",
      "config/bot-testnet.json",
      "config/tester-testnet.json",
    ])) });
    let spawned = false;
    let createdOutputDirectory = false;

    await expect(supervise(args, plan, {
      existsSync: (path) => !pathToString(path).endsWith("forks/ccc/repo/packages/udt/dist/index.js"),
      spawnCommand: (() => {
        spawned = true;
        return fakeChild("");
      }) as never,
      stat: missingStat,
      mkdir: () => {
        createdOutputDirectory = true;
        return Promise.resolve(undefined);
      },
    })).rejects.toThrow("Missing built CCC UDT: forks/ccc/repo/packages/udt/dist/index.js");
    expect(spawned).toBe(false);
    expect(createdOutputDirectory).toBe(false);
  });
});

describe("evidence parsing", () => {
  it("keeps JSON records, discards banners, and flags malformed JSON", () => {
    const evidence = parseJsonEvidence([
      "> package banner",
      JSON.stringify({ app: "bot", type: "bot.run.started" }),
      "{not-json}",
      "",
    ].join("\n"));

    expect(evidence.records).toHaveLength(1);
    expect(evidence.ignoredLines).toEqual(["> package banner"]);
    expect(evidence.malformedLines).toEqual(["{not-json}"]);
  });

  it("parses pretty preflight JSON as one report", () => {
    const evidence = parsePreflightEvidence(JSON.stringify({ chain: "testnet" }, null, 2));

    expect(evidence.records).toEqual([{ chain: "testnet" }]);
    expect(evidence.malformedLines).toEqual([]);
  });
});

describe("classification", () => {
  it("classifies tester order creation", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: { newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" }, cancelledOrders: 0 },
      txHash: txHash("11"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result).outcome).toBe("tester_order_created");
  });

  it("classifies tester direct conversions separately from order creation", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: { conversion: { kind: "direct" }, cancelledOrders: 0 },
      txHash: txHash("12"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result).outcome).toBe("tester_conversion_created");
  });

  it("classifies tester hybrid direct-plus-order conversions as conversion coverage", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        conversion: { kind: "direct-plus-order" },
        newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" },
        cancelledOrders: 0,
      },
      txHash: txHash("13"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result).outcome).toBe("tester_conversion_created");
  });

  it("rejects committed tester evidence without a valid tx hash", () => {
    expect(classifyActorResult("tester", commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: { newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" }, cancelledOrders: 0 },
      txHash: "not-a-tx-hash",
      ElapsedSeconds: 1,
    })))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester committed transaction evidence did not include a valid tx hash",
    });
  });

  it("rejects committed tester evidence without action evidence", () => {
    expect(classifyActorResult("tester", commandResult("tester", JSON.stringify({
      startTime: "now",
      txHash: txHash("25"),
      ElapsedSeconds: 1,
    })))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester committed transaction evidence did not include action evidence",
    });
    expect(classifyActorResult("tester", commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: { cancelledOrders: 0 },
      txHash: txHash("26"),
      ElapsedSeconds: 1,
    })))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester committed transaction evidence did not include action evidence",
    });
  });

  it("classifies tester SDK order conversions as conversion coverage", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        conversion: { kind: "order" },
        newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" },
        cancelledOrders: 0,
      },
      txHash: txHash("14"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result).outcome).toBe("tester_conversion_created");
  });

  it("accepts explicit iCKB-to-CKB tester scenario evidence", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        testerScenario: "ickb-to-ckb-limit-order",
        newOrder: { giveIckb: "10", takeCkb: "9", fee: "0.1" },
        collectedOrders: 2,
        cancelledOrders: 1,
      },
      txHash: txHash("15"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "ickb-to-ckb-limit-order" })).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
      testerOrder: {
        testerScenario: "ickb-to-ckb-limit-order",
        orderCount: 1,
        collectedOrders: 2,
        cancelledOrders: 1,
        orders: [{ direction: "ickb-to-ckb", giveIckb: "10", takeCkb: "9", fee: "0.1", dust: false }],
      },
    });
  });

  it("captures dust tester order evidence", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        requestedTesterScenario: "auto",
        testerScenario: "dust-ckb-conversion",
        newOrder: { giveCkb: "0.00000001", takeIckb: "0.00000001", fee: "0", feeNumerator: "1", feeBase: "100000" },
        cancelledOrders: 1,
      },
      txHash: txHash("17"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "tester_order_created",
      testerOrder: {
        requestedTesterScenario: "auto",
        testerScenario: "dust-ckb-conversion",
        orderCount: 1,
        cancelledOrders: 1,
        orders: [{ direction: "ckb-to-ickb", giveCkb: "0.00000001", takeIckb: "0.00000001", fee: "0", feeNumerator: "1", feeBase: "100000", dust: true }],
      },
    });
  });

  it("accepts either order direction for explicit random-order evidence", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        testerScenario: "random-order",
        newOrder: { giveIckb: "10", takeCkb: "9", fee: "0.1" },
        cancelledOrders: 0,
      },
      txHash: txHash("18"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "random-order" })).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
  });

  it("accepts explicit two-order CKB-to-iCKB tester scenario evidence", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        testerScenario: "two-ckb-to-ickb-limit-orders",
        newOrders: [
          { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          { giveCkb: "20", takeIckb: "18", fee: "0.2" },
        ],
        orderCount: 2,
        cancelledOrders: 0,
      },
      txHash: txHash("19"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "two-ckb-to-ickb-limit-orders" })).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
  });

  it("accepts any concrete multi-order evidence for generic multi-order tester expectations", () => {
    const mixedResult = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        requestedTesterScenario: "multi-order-limit-orders",
        testerScenario: "mixed-direction-limit-orders",
        newOrders: [
          { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          { giveIckb: "20", takeCkb: "18", fee: "0.2" },
        ],
        orderCount: 2,
        cancelledOrders: 0,
      },
      txHash: txHash("20"),
      ElapsedSeconds: 1,
    }));
    const ckbResult = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        requestedTesterScenario: "multi-order-limit-orders",
        testerScenario: "two-ckb-to-ickb-limit-orders",
        newOrders: [
          { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          { giveCkb: "20", takeIckb: "18", fee: "0.2" },
        ],
        orderCount: 2,
        cancelledOrders: 0,
      },
      txHash: txHash("21"),
      ElapsedSeconds: 1,
    }));
    const ickbResult = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        requestedTesterScenario: "multi-order-limit-orders",
        testerScenario: "two-ickb-to-ckb-limit-orders",
        newOrders: [
          { giveIckb: "10", takeCkb: "9", fee: "0.1" },
          { giveIckb: "20", takeCkb: "18", fee: "0.2" },
        ],
        orderCount: 2,
        cancelledOrders: 0,
      },
      txHash: txHash("22"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", mixedResult, { scenario: "multi-order-limit-orders" })).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
    expect(classifyActorResult("tester", ckbResult, { scenario: "multi-order-limit-orders" })).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
    expect(classifyActorResult("tester", ickbResult, { scenario: "multi-order-limit-orders" })).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
  });

  it("rejects non-multi-order evidence for generic multi-order tester expectations", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        testerScenario: "random-order",
        newOrders: [
          { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          { giveIckb: "20", takeCkb: "18", fee: "0.2" },
        ],
        orderCount: 2,
        cancelledOrders: 0,
      },
      txHash: txHash("23"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "multi-order-limit-orders" })).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason: "tester scenario multi-order-limit-orders committed with non-multi-order selected scenario evidence",
    });
  });

  it("rejects concrete direction mismatches for generic multi-order tester expectations", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        requestedTesterScenario: "multi-order-limit-orders",
        testerScenario: "mixed-direction-limit-orders",
        newOrders: [
          { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          { giveCkb: "20", takeIckb: "18", fee: "0.2" },
        ],
        orderCount: 2,
        cancelledOrders: 0,
      },
      txHash: txHash("24"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "multi-order-limit-orders" })).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason: "tester scenario multi-order-limit-orders committed without mixed order direction evidence",
    });
  });

  it("rejects wrong order count evidence for explicit two-order scenarios", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        testerScenario: "two-ckb-to-ickb-limit-orders",
        newOrders: [{ giveCkb: "10", takeIckb: "9", fee: "0.1" }],
        orderCount: 1,
        cancelledOrders: 0,
      },
      txHash: txHash("1a"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "two-ckb-to-ickb-limit-orders" })).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason: "tester scenario two-ckb-to-ickb-limit-orders committed without 2 new order evidence entries",
    });
  });

  it("accepts explicit two-order iCKB-to-CKB tester scenario evidence", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        testerScenario: "two-ickb-to-ckb-limit-orders",
        newOrders: [
          { giveIckb: "10", takeCkb: "9", fee: "0.1" },
          { giveIckb: "20", takeCkb: "18", fee: "0.2" },
        ],
        orderCount: 2,
        cancelledOrders: 0,
      },
      txHash: txHash("1b"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "two-ickb-to-ckb-limit-orders" })).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
  });

  it("rejects wrong order direction evidence for explicit two-order iCKB-to-CKB scenarios", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        testerScenario: "two-ickb-to-ckb-limit-orders",
        newOrders: [
          { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          { giveCkb: "20", takeIckb: "18", fee: "0.2" },
        ],
        orderCount: 2,
        cancelledOrders: 0,
      },
      txHash: txHash("1c"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "two-ickb-to-ckb-limit-orders" })).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason: "tester scenario two-ickb-to-ckb-limit-orders committed with wrong order direction evidence",
    });
  });

  it("accepts explicit mixed-direction tester scenario evidence", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        testerScenario: "mixed-direction-limit-orders",
        newOrders: [
          { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          { giveIckb: "20", takeCkb: "18", fee: "0.2" },
        ],
        orderCount: 2,
        cancelledOrders: 0,
      },
      txHash: txHash("1d"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "mixed-direction-limit-orders" })).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
  });

  it("rejects same-direction evidence for explicit mixed-direction scenarios", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        testerScenario: "mixed-direction-limit-orders",
        newOrders: [
          { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          { giveCkb: "20", takeIckb: "18", fee: "0.2" },
        ],
        orderCount: 2,
        cancelledOrders: 0,
      },
      txHash: txHash("1e"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "mixed-direction-limit-orders" })).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason: "tester scenario mixed-direction-limit-orders committed without mixed order direction evidence",
    });
  });

  it("rejects ambiguous mixed-direction order evidence", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        testerScenario: "mixed-direction-limit-orders",
        newOrders: [
          { giveCkb: "10", takeIckb: "9", giveIckb: "20", takeCkb: "18", fee: "0.1" },
          "not-an-order",
        ],
        orderCount: 2,
        cancelledOrders: 0,
      },
      txHash: txHash("1f"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "mixed-direction-limit-orders" })).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason: "tester scenario mixed-direction-limit-orders committed without mixed order direction evidence",
    });
  });

  it("rejects committed tester evidence that does not match the explicit scenario", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        testerScenario: "ickb-to-ckb-limit-order",
        newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" },
        cancelledOrders: 0,
      },
      txHash: txHash("16"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "ickb-to-ckb-limit-order" })).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason: "tester scenario ickb-to-ckb-limit-order committed with wrong order direction evidence",
    });
  });

  it("accepts bounded iCKB-to-CKB tester scenario evidence", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        testerScenario: "bounded-ickb-to-ckb-limit-order",
        newOrder: { giveIckb: "10", takeCkb: "9", fee: "0.1" },
        cancelledOrders: 0,
      },
      txHash: txHash("18"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "bounded-ickb-to-ckb-limit-order" })).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
  });

  it("requires conversion evidence for explicit SDK conversion scenarios", () => {
    const result = commandResult("tester", JSON.stringify({
      startTime: "now",
      actions: {
        testerScenario: "sdk-conversion",
        newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" },
        cancelledOrders: 0,
      },
      txHash: txHash("17"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "sdk-conversion" })).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason: "tester scenario sdk-conversion committed without conversion evidence",
    });
  });

  it("classifies tester fresh-order and sampled-too-small skips", () => {
    expect(classifyActorResult("tester", commandResult("tester", JSON.stringify({
      skip: { reason: "fresh-matchable-order", txHash: txHash("22") },
    }))).outcome).toBe("tester_fresh_order_skip");
    expect(classifyActorResult("tester", commandResult("tester", JSON.stringify({
      skip: { reason: "matchable-order-transaction-missing", txHash: txHash("23") },
    })))).toMatchObject({
      outcome: "tester_fresh_order_skip",
      terminal: false,
      skipReason: "matchable-order-transaction-missing",
    });
    expect(classifyActorResult("tester", commandResult("tester", JSON.stringify({
      skip: { reason: "sampled-amount-too-small" },
    }))).outcome).toBe("tester_sampled_too_small_skip");
    expect(classifyActorResult("tester", commandResult("tester", JSON.stringify({
      skip: { reason: "post-tx-ckb-reserve" },
    })))).toMatchObject({
      outcome: "tester_reserve_skip",
      terminal: false,
      skipReason: "post-tx-ckb-reserve",
    });
  });

  it("classifies bot committed actions", () => {
    const stdout = [
      botEvent("bot.state.read", {
        orders: { marketCount: 4, userCount: 0, receiptCount: 1 },
        poolDeposits: { readyCount: 2, nearReadyCount: 1, futureCount: 3 },
      }),
      botEvent("bot.transaction.built", {
        actions: { collectedOrders: 0, completedDeposits: 0, matchedOrders: 1, deposits: 1, withdrawalRequests: 0, withdrawals: 0 },
        decision: {
          match: {
            diagnostics: {
              directions: {
                ckbToUdt: { matchableCount: 5 },
                udtToCkb: { matchableCount: 6 },
              },
              candidates: { viable: 7, positiveGain: 8 },
            },
          },
        },
      }),
      botEvent("bot.transaction.committed", { txHash: txHash("33"), status: "committed" }),
    ].map(JSON.stringify).join("\n");
    const classification = classifyActorResult("bot", commandResult("bot", stdout));

    expect(classification.outcome).toBe("bot_match_plus_deposit_committed");
    expect(classification.txHashes).toEqual([txHash("33")]);
    expect(classification.publicState).toEqual({
      marketOrderCount: 4,
      userOrderCount: 0,
      receiptCount: 1,
      ckbToUdtMatchableOrderCount: 5,
      udtToCkbMatchableOrderCount: 6,
      viableMatchCandidateCount: 7,
      positiveGainMatchCandidateCount: 8,
      readyPoolDepositCount: 2,
      nearReadyPoolDepositCount: 1,
      futurePoolDepositCount: 3,
    });
  });

  it("classifies matched withdrawal requests as withdrawal coverage", () => {
    const stdout = [
      botEvent("bot.transaction.built", {
        actions: { collectedOrders: 0, completedDeposits: 0, matchedOrders: 1, deposits: 0, withdrawalRequests: 1, withdrawals: 0 },
      }),
      botEvent("bot.transaction.committed", { txHash: txHash("39"), status: "committed" }),
    ].map(JSON.stringify).join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_withdrawal_request_committed",
      actions: { matchedOrders: 1, deposits: 0, withdrawalRequests: 1 },
      txHashes: [txHash("39")],
    });
  });

  it("classifies matched receipt completions as receipt coverage", () => {
    const stdout = [
      botEvent("bot.transaction.built", {
        actions: { collectedOrders: 0, completedDeposits: 1, matchedOrders: 1, deposits: 0, withdrawalRequests: 0, withdrawals: 0 },
      }),
      botEvent("bot.transaction.committed", { txHash: txHash("40"), status: "committed" }),
    ].map(JSON.stringify).join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_receipt_completion_committed",
      actions: { completedDeposits: 1, matchedOrders: 1, deposits: 0 },
      txHashes: [txHash("40")],
    });
  });

  it("classifies matched withdrawal completions as withdrawal completion coverage", () => {
    const stdout = [
      botEvent("bot.transaction.built", {
        actions: { collectedOrders: 0, completedDeposits: 0, matchedOrders: 1, deposits: 0, withdrawalRequests: 0, withdrawals: 1 },
      }),
      botEvent("bot.transaction.committed", { txHash: txHash("41"), status: "committed" }),
    ].map(JSON.stringify).join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_withdrawal_completion_committed",
      actions: { matchedOrders: 1, deposits: 0, withdrawals: 1 },
      txHashes: [txHash("41")],
    });
  });

  it("classifies deposit-only commits as deposit coverage", () => {
    const stdout = [
      botEvent("bot.transaction.built", {
        actions: { collectedOrders: 0, completedDeposits: 0, matchedOrders: 0, deposits: 1, withdrawalRequests: 0, withdrawals: 0 },
      }),
      botEvent("bot.transaction.committed", { txHash: txHash("42"), status: "committed" }),
    ].map(JSON.stringify).join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_deposit_only_committed",
      actions: { matchedOrders: 0, deposits: 1 },
      txHashes: [txHash("42")],
    });
  });

  it("treats committed bot transactions without classifiable actions as terminal", () => {
    const stdout = [
      botEvent("bot.transaction.built", {
        actions: { collectedOrders: 0, completedDeposits: 0, matchedOrders: 0, deposits: 0, withdrawalRequests: 0, withdrawals: 0 },
      }),
      botEvent("bot.transaction.committed", { txHash: txHash("47"), status: "committed" }),
    ].map(JSON.stringify).join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "unknown",
      terminal: true,
      reason: "bot committed transaction evidence did not include classifiable action evidence",
      actions: { matchedOrders: 0, deposits: 0, withdrawalRequests: 0, completedDeposits: 0, withdrawals: 0 },
      txHashes: [txHash("47")],
    });
  });

  it("keeps match diagnostics tied to the matching state-read iteration", () => {
    const stdout = [
      botEvent("bot.state.read", {
        iterationId: 1,
        orders: { marketCount: 4, userCount: 0, receiptCount: 1 },
        poolDeposits: { readyCount: 2, nearReadyCount: 1, futureCount: 3 },
      }),
      botEvent("bot.transaction.built", {
        iterationId: 1,
        actions: { collectedOrders: 0, completedDeposits: 0, matchedOrders: 1, deposits: 1, withdrawalRequests: 0, withdrawals: 0 },
        decision: {
          match: {
            diagnostics: {
              directions: {
                ckbToUdt: { matchableCount: 5 },
                udtToCkb: { matchableCount: 6 },
              },
              candidates: { viable: 7, positiveGain: 8 },
            },
          },
        },
      }),
      botEvent("bot.state.read", {
        iterationId: 2,
        orders: { marketCount: 9, userCount: 1, receiptCount: 0 },
        poolDeposits: { readyCount: 0, nearReadyCount: 0, futureCount: 0 },
      }),
      botEvent("bot.iteration.failed", {
        iterationId: 2,
        retryable: true,
        terminal: false,
        error: { name: "TypeError", message: "fetch failed" },
      }),
    ].map(JSON.stringify).join("\n");
    const classification = classifyActorResult("bot", commandResult("bot", stdout));

    expect(classification.publicState).toEqual({
      marketOrderCount: 9,
      userOrderCount: 1,
      receiptCount: 0,
      ckbToUdtMatchableOrderCount: undefined,
      udtToCkbMatchableOrderCount: undefined,
      viableMatchCandidateCount: undefined,
      positiveGainMatchCandidateCount: undefined,
      readyPoolDepositCount: 0,
      nearReadyPoolDepositCount: 0,
      futurePoolDepositCount: 0,
    });
    expect(classification).toMatchObject({
      outcome: "bot_retryable_error",
      terminal: false,
      reason: "bot reported retryable iteration failure",
    });
  });

  it("classifies bot committed actions from the matching iteration", () => {
    const stdout = [
      botEvent("bot.iteration.failed", {
        iterationId: 0,
        retryable: false,
        terminal: true,
        error: { name: "Error", message: "L1 state scan crossed chain tip; retry with a fresh state" },
      }),
      botEvent("bot.transaction.built", {
        iterationId: 1,
        actions: { collectedOrders: 0, completedDeposits: 0, matchedOrders: 1, deposits: 0, withdrawalRequests: 0, withdrawals: 0 },
      }),
      botEvent("bot.transaction.built", {
        iterationId: 2,
        actions: { collectedOrders: 0, completedDeposits: 0, matchedOrders: 0, deposits: 1, withdrawalRequests: 0, withdrawals: 0 },
      }),
      botEvent("bot.transaction.committed", { iterationId: 1, txHash: txHash("37"), status: "committed" }),
    ].map(JSON.stringify).join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_match_committed",
      actions: { matchedOrders: 1, deposits: 0 },
    });
  });

  it("classifies later bot commits over older transaction failures", () => {
    const stdout = [
      botEvent("bot.transaction.built", {
        iterationId: 1,
        actions: { collectedOrders: 0, completedDeposits: 0, matchedOrders: 1, deposits: 0, withdrawalRequests: 0, withdrawals: 0 },
      }),
      botEvent("bot.transaction.failed", {
        iterationId: 1,
        outcome: "post_broadcast_unresolved",
        txHash: txHash("43"),
      }),
      botEvent("bot.transaction.committed", { iterationId: 1, txHash: txHash("44"), status: "committed" }),
    ].map(JSON.stringify).join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_match_committed",
      terminal: false,
      actions: { matchedOrders: 1, deposits: 0 },
      txHashes: [txHash("44")],
    });
  });

  it("classifies later bot transaction failures over older commits", () => {
    const stdout = [
      botEvent("bot.transaction.built", {
        iterationId: 1,
        actions: { collectedOrders: 0, completedDeposits: 0, matchedOrders: 1, deposits: 0, withdrawalRequests: 0, withdrawals: 0 },
      }),
      botEvent("bot.transaction.committed", { iterationId: 1, txHash: txHash("45"), status: "committed" }),
      botEvent("bot.transaction.failed", {
        iterationId: 1,
        outcome: "terminal_rejection",
        txHash: txHash("46"),
      }),
    ].map(JSON.stringify).join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "terminal_chain_rejection",
      terminal: true,
      txHashes: [txHash("46")],
    });
  });

  it("rejects bot post-broadcast failures without a valid tx hash", () => {
    const stdout = JSON.stringify(botEvent("bot.transaction.failed", {
      outcome: "post_broadcast_unresolved",
      txHash: "not-a-tx-hash",
    }));

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot post-broadcast transaction failure evidence did not include a valid tx hash",
    });
  });

  it("keeps pre-broadcast bot failures classified without tx hash evidence", () => {
    const stdout = JSON.stringify(botEvent("bot.transaction.failed", {
      outcome: "validation_failed",
      phase: "pre_broadcast",
    }));

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "unknown",
      terminal: true,
      reason: "bot pre-broadcast transaction failure",
    });
  });

  it("classifies bot skips after earlier terminal iteration failures", () => {
    const stdout = [
      botEvent("bot.iteration.failed", {
        iterationId: 1,
        retryable: false,
        terminal: true,
        error: { name: "Error", message: "L1 state scan crossed chain tip; retry with a fresh state" },
      }),
      botEvent("bot.decision.skipped", {
        iterationId: 2,
        reason: "no_actions",
        actions: emptyActions(),
      }),
    ].map(JSON.stringify).join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_no_action_skip",
      terminal: false,
      skipReason: "no_actions",
    });
  });

  it("classifies bot skips after earlier retryable pre-broadcast failures", () => {
    const stdout = [
      botEvent("bot.transaction.failed", {
        iterationId: 1,
        phase: "pre_broadcast",
        outcome: "pre_broadcast_failed",
        retryable: true,
        terminal: false,
        error: { name: "TypeError", message: "fetch failed" },
      }),
      botEvent("bot.decision.skipped", {
        iterationId: 2,
        reason: "no_actions",
        actions: emptyActions(),
      }),
    ].map(JSON.stringify).join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_no_action_skip",
      terminal: false,
      skipReason: "no_actions",
    });
  });

  it("rejects committed bot evidence without matching built action evidence", () => {
    const stdout = [
      botEvent("bot.transaction.built", {
        iterationId: 1,
        actions: { collectedOrders: 0, completedDeposits: 0, matchedOrders: 1, deposits: 0, withdrawalRequests: 0, withdrawals: 0 },
      }),
      botEvent("bot.transaction.committed", { iterationId: 2, txHash: txHash("38"), status: "committed" }),
    ].map(JSON.stringify).join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot committed transaction evidence did not include matching built action evidence",
    });
  });

  it("rejects committed bot evidence without a valid tx hash", () => {
    const stdout = [
      botEvent("bot.transaction.built", {
        actions: { collectedOrders: 0, completedDeposits: 0, matchedOrders: 1, deposits: 1, withdrawalRequests: 0, withdrawals: 0 },
      }),
      botEvent("bot.transaction.committed", { txHash: "not-a-tx-hash", status: "committed" }),
    ].map(JSON.stringify).join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot committed transaction evidence did not include a valid tx hash",
    });
  });

  it("classifies bot no-action and low-capital skips", () => {
    expect(classifyActorResult("bot", commandResult("bot", JSON.stringify(botEvent("bot.decision.skipped", {
      reason: "no_actions",
      actions: emptyActions(),
    })))).outcome).toBe("bot_no_action_skip");
    expect(classifyActorResult("bot", commandResult("bot", JSON.stringify(botEvent("bot.decision.skipped", {
      reason: "capital_below_minimum",
      actions: emptyActions(),
    })))).outcome).toBe("low_capital_stop");
  });

  it("keeps bot low-capital safety stops classified despite exit code 2", () => {
    const result = {
      ...commandResult("bot", JSON.stringify(botEvent("bot.decision.skipped", {
        reason: "capital_below_minimum",
        actions: emptyActions(),
      }))),
      status: 2,
    };

    expect(classifyActorResult("bot", result)).toMatchObject({
      outcome: "low_capital_stop",
      terminal: true,
      skipReason: "capital_below_minimum",
    });
  });

  it("treats nonzero actor exits as terminal even when stdout has success evidence", () => {
    const botResult = {
      ...commandResult("bot", JSON.stringify(botEvent("bot.decision.skipped", {
        reason: "no_actions",
        actions: emptyActions(),
      }))),
      status: 1,
    };
    const testerResult = {
      ...commandResult("tester", JSON.stringify({ txHash: txHash("99") })),
      status: 1,
    };

    expect(classifyActorResult("bot", botResult)).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
    });
    expect(classifyActorResult("tester", testerResult)).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
    });
  });

  it("treats nonzero bot exits as terminal even with retryable iteration evidence", () => {
    const result = {
      ...commandResult("bot", JSON.stringify(botEvent("bot.iteration.failed", {
        retryable: true,
        terminal: false,
        error: { name: "TypeError", message: "fetch failed" },
      }))),
      status: 1,
    };

    expect(classifyActorResult("bot", result)).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
    });
  });

  it("keeps terminal bot retry-budget exhaustion classified by bot evidence despite exit code 2", () => {
    const result = {
      ...commandResult("bot", JSON.stringify(botEvent("bot.iteration.failed", {
        retryable: true,
        terminal: true,
        retryableAttempts: 3,
        maxRetryableAttempts: 3,
        retryBudgetExhausted: true,
        error: { name: "TypeError", message: "fetch failed" },
      }))),
      status: 2,
    };

    expect(classifyActorResult("bot", result)).toMatchObject({
      outcome: "bot_retryable_error",
      terminal: true,
      reason: "bot reported terminal retryable iteration failure",
    });
  });

  it("reports spawn errors before generic actor exit classification", () => {
    expect(classifyActorResult("preflight", { ...commandResult("preflight", ""), spawnError: "ENOENT", status: null })).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
      reason: "preflight failed to spawn: ENOENT",
    });
    expect(classifyActorResult("bot", { ...commandResult("bot", ""), spawnError: "ENOENT", status: null })).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
      reason: "bot failed to spawn: ENOENT",
    });
    expect(classifyActorResult("tester", { ...commandResult("tester", ""), spawnError: "ENOENT", status: null })).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
      reason: "tester failed to spawn: ENOENT",
    });
  });

  it("preserves accepted tx hashes in generic early classifications", () => {
    expect(classifyActorResult("tester", {
      ...commandResult("tester", JSON.stringify({ txHash: txHash("50") })),
      timedOut: true,
    })).toMatchObject({
      outcome: "command_timeout",
      txHashes: [txHash("50")],
    });
    expect(classifyActorResult("bot", {
      ...commandResult("bot", JSON.stringify(botEvent("bot.transaction.committed", { txHash: txHash("51") }))),
      spawnError: "ENOENT",
      status: null,
    })).toMatchObject({
      outcome: "nonzero_exit",
      txHashes: [txHash("51")],
    });
    expect(classifyActorResult("bot", {
      ...commandResult("bot", JSON.stringify(botEvent("bot.transaction.committed", { txHash: txHash("52") }))),
      stdoutTruncated: true,
    })).toMatchObject({
      outcome: "malformed_evidence",
      txHashes: [txHash("52")],
    });
    expect(classifyActorResult("tester", commandResult("tester", [
      JSON.stringify({ txHash: txHash("53") }),
      "{not-json}",
    ].join("\n")))).toMatchObject({
      outcome: "malformed_evidence",
      txHashes: [txHash("53")],
    });
  });

  it("preserves accepted preflight tx hashes in generic early classifications", () => {
    expect(classifyActorResult("preflight", {
      ...commandResult("preflight", JSON.stringify({ txHash: txHash("54"), bounded: true, maxIterations: 1 }, null, 2)),
      timedOut: true,
    })).toMatchObject({
      outcome: "command_timeout",
      txHashes: [txHash("54")],
    });
  });

  it("does not preserve conflicted tx hashes in generic early classifications", () => {
    expect(classifyActorResult("tester", {
      ...commandResult("tester", JSON.stringify({ txHash: txHash("56"), error: { txHash: txHash("57") } })),
      timedOut: true,
    })).toMatchObject({
      outcome: "command_timeout",
      txHashes: [],
    });
  });

  it("rejects bot post-broadcast failures with mismatched tx hash evidence", () => {
    const stdout = JSON.stringify(botEvent("bot.transaction.failed", {
      outcome: "post_broadcast_unresolved",
      txHash: txHash("58"),
      error: { txHash: txHash("59") },
    }));

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot post-broadcast transaction failure evidence contained mismatched tx hashes",
      txHashes: [],
    });
  });

  it("rejects tester skips with mismatched tx hash evidence", () => {
    const stdout = JSON.stringify({
      txHash: txHash("5a"),
      skip: { reason: "fresh-matchable-order", txHash: txHash("5b") },
    });

    expect(classifyActorResult("tester", commandResult("tester", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester skip evidence contained mismatched tx hashes",
      txHashes: [],
    });
  });

  it("keeps tester confirmation timeouts classified by safety evidence despite exit code 2", () => {
    const result = {
      ...commandResult("tester", JSON.stringify({
        txHash: txHash("aa"),
        error: {
          name: "TransactionConfirmationError",
          message: "Transaction confirmation timed out",
          txHash: txHash("aa"),
          status: "sent",
          isTimeout: true,
        },
      })),
      status: 2,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "confirmation_timeout",
      terminal: true,
    });
  });

  it("counts matching top-level and nested tester transaction failure tx hashes once", () => {
    const result = {
      ...commandResult("tester", JSON.stringify({
        txHash: txHash("ae"),
        error: {
          name: "TransactionConfirmationError",
          message: "Transaction confirmation timed out",
          txHash: txHash("ae"),
          isTimeout: true,
        },
      })),
      status: 2,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "confirmation_timeout",
      terminal: true,
      txHashes: [txHash("ae")],
    });
  });

  it("rejects mismatched top-level and nested tester transaction failure tx hashes", () => {
    const result = {
      ...commandResult("tester", JSON.stringify({
        txHash: txHash("ae"),
        error: {
          name: "TransactionConfirmationError",
          message: "Transaction confirmation timed out",
          txHash: txHash("af"),
          isTimeout: true,
        },
      })),
      status: 2,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester transaction failure evidence contained mismatched tx hashes",
      txHashes: [],
    });
  });

  it("classifies serialized tester post-broadcast unresolved failures", () => {
    const result = {
      ...commandResult("tester", JSON.stringify({
        txHash: txHash("ab"),
        error: {
          name: "TransactionConfirmationError",
          message: "Transaction confirmation timed out",
          txHash: txHash("ab"),
          status: "sent",
          isTimeout: true,
          cause: { name: "TypeError", message: "fetch failed" },
        },
      })),
      status: 2,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "post_broadcast_unresolved",
      terminal: true,
      reason: "tester tx remained unresolved after broadcast",
    });
  });

  it("classifies serialized tester terminal chain rejections", () => {
    const result = {
      ...commandResult("tester", JSON.stringify({
        txHash: txHash("ac"),
        error: {
          name: "TransactionConfirmationError",
          message: "Transaction reached rejected status",
          txHash: txHash("ac"),
          status: "rejected",
          isTimeout: false,
        },
      })),
      status: 1,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "terminal_chain_rejection",
      terminal: true,
      reason: "tester tx reached terminal chain rejection",
    });
  });

  it("rejects tester transaction failures without valid tx hash evidence", () => {
    const result = {
      ...commandResult("tester", JSON.stringify({
        error: {
          name: "TransactionConfirmationError",
          message: "Transaction confirmation timed out",
          isTimeout: true,
        },
      })),
      status: 2,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester transaction failure evidence did not include a valid tx hash",
    });
  });

  it("extracts nested tester transaction failure tx hash evidence", () => {
    const result = {
      ...commandResult("tester", JSON.stringify({
        error: {
          name: "TransactionConfirmationError",
          message: "Transaction confirmation timed out",
          txHash: txHash("ad"),
          isTimeout: true,
        },
      })),
      status: 2,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "confirmation_timeout",
      terminal: true,
      txHashes: [txHash("ad")],
    });
  });

  it("classifies serialized tester funding failures as low-capital stops", () => {
    const result = {
      ...commandResult("tester", JSON.stringify({
        error: {
          name: "TesterTerminalError",
          message: "Not enough CKB for all-CKB limit order scenario",
        },
      })),
      status: 1,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "low_capital_stop",
      terminal: true,
    });
  });

  it("safety classifications preserve ordinary command precedence", () => {
    expect(classifyActorResult("bot", commandResult("bot", "{not-json}"))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
    });
    expect(classifyActorResult("bot", { ...commandResult("bot", ""), timedOut: true })).toMatchObject({
      outcome: "command_timeout",
      terminal: true,
    });
    expect(classifyActorResult("bot", commandResult("bot", [
      JSON.stringify(botEvent("bot.decision.skipped", { reason: "no_actions", actions: emptyActions() })),
      JSON.stringify({ witnesses: ["0xsignature"], inputs: [] }),
    ].join("\n")))).toMatchObject({
      outcome: "bot_no_action_skip",
      terminal: false,
    });
  });

  it("classifies terminal preflight command failures before launch", () => {
    expect(classifyActorResult("preflight", { ...commandResult("preflight", ""), timedOut: true })).toMatchObject({
      outcome: "command_timeout",
      terminal: true,
    });
  });

  it("requires preflight configs to bound actors to one iteration", () => {
    expect(classifyActorResult("preflight", commandResult("preflight", JSON.stringify({
      chain: "testnet",
      bounded: false,
    })))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "preflight config is not bounded to one iteration",
    });
    expect(classifyActorResult("preflight", commandResult("preflight", JSON.stringify({
      chain: "testnet",
      bounded: true,
      maxIterations: 2,
    })))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "preflight config is not bounded to one iteration",
    });
  });

  it("fails closed when captured command output is truncated", () => {
    expect(classifyActorResult("bot", {
      ...commandResult("bot", JSON.stringify(botEvent("bot.decision.skipped", {
        reason: "no_actions",
        actions: emptyActions(),
      }))),
      stdoutTruncated: true,
    })).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "stdout evidence exceeded supervisor capture limit",
      evidence: { stdoutTruncated: true },
    });
    expect(classifyActorResult("preflight", {
      ...commandResult("preflight", JSON.stringify({ chain: "testnet", bounded: true, maxIterations: 1 })),
      stderrTruncated: true,
    })).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "stderr evidence exceeded supervisor capture limit",
      evidence: { stderrTruncated: true },
    });
  });

  it("preserves transaction-shaped preflight stderr for artifact capture", () => {
    const classification = classifyActorResult("preflight", {
      ...commandResult("preflight", "{}"),
      status: 1,
      stderr: JSON.stringify({ witnesses: ["0xsignature"], inputs: [] }),
    });

    expect(classification).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
      reason: JSON.stringify({ witnesses: ["0xsignature"], inputs: [] }),
    });
  });

  it("preserves snake_case CKB transaction fields for artifact capture", () => {
    const classification = classifyActorResult("preflight", {
      ...commandResult("preflight", "{}"),
      status: 1,
      stderr: JSON.stringify({ cell_deps: [], header_deps: [], outputs_data: ["0x"] }),
    });

    expect(classification).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
      reason: JSON.stringify({ cell_deps: [], header_deps: [], outputs_data: ["0x"] }),
    });
  });

  it("classifies retryable preflight transport failures separately", () => {
    expect(classifyActorResult("preflight", {
      ...commandResult("preflight", ""),
      status: 1,
      stderr: "Live preflight retryable failure: fetch failed\n",
    })).toMatchObject({
      outcome: "preflight_retryable_error",
      terminal: true,
    });
  });

  it("classifies preserved wrong-chain preflight evidence", () => {
    expect(classifyActorResult("preflight", {
      ...commandResult("preflight", ""),
      status: 1,
      stderr: "Live preflight failed: Invalid testnet RPC chain identity: genesis hash expected 0x1 observed 0x2\n",
    })).toMatchObject({
      outcome: "wrong_chain",
      terminal: true,
    });
  });

  it("caps captured command output", () => {
    const capture = createBoundedOutputCapture();
    appendBoundedOutput(capture, Buffer.from("abcdef"), 4);
    appendBoundedOutput(capture, Buffer.from("gh"), 4);

    expect(boundedOutputText(capture)).toBe("abcd\n<truncated 4 bytes>");
  });

  it("kills timed-out actor commands after the grace period", async () => {
    vi.useFakeTimers();
    try {
      const writes = new Map<string, string>();
      const kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      const args = parseArgs([
        "--out-dir", "logs/live-supervisor/timeout-kill-test",
        "--scenario", "bot-only",
        "--target-outcome", "bot_match_committed",
        "--max-cycles", "1",
        "--command-timeout-seconds", "1",
      ]);
      const plan = resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
        "logs/live-supervisor/timeout-kill-test",
        "config/bot-testnet.json",
        "config/tester-testnet.json",
      ])) });
      const child = fakeHangingChild();

      const run = supervise(args, plan, {
        skipBuiltRuntimeCheck: true,
        commandKillGraceMs: 10,
        killProcess: (pid, signal) => {
          kills.push({ pid, signal });
          if (signal === "SIGKILL") {
            queueMicrotask(() => child.emit("close", null, "SIGKILL"));
          }
        },
        spawnCommand: ((_command: string, commandArgs: string[]) => isPreflightCommand(commandArgs) ? fakeSuccessfulPreflightChild() : child) as never,
        spawnSyncCommand: ignoredChecker(true) as never,
        lstat: missingStat,
        stat: missingStat,
        mkdir: () => Promise.resolve(undefined),
        realpath: (path) => Promise.resolve(pathToString(path)),
        appendFile: (path, text) => {
          const key = pathToString(path);
          writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
          return Promise.resolve();
        },
        writeFile: (path, text) => {
          writes.set(pathToString(path), textToString(text));
          return Promise.resolve();
        },
      });

      await vi.advanceTimersByTimeAsync(1010);

      await expect(run).resolves.toBe(2);
      expect(kills).toEqual([
        { pid: -1234, signal: "SIGTERM" },
        { pid: -1234, signal: "SIGKILL" },
      ]);
      expect(writes.get("/repo/logs/live-supervisor/timeout-kill-test/cycle-0001-incident.json")).toContain(
        "command_timeout",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds in-flight actor commands by the remaining wall-clock budget", async () => {
    vi.useFakeTimers();
    try {
      const writes = new Map<string, string>();
      const kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      const args = parseArgs([
        "--out-dir", "logs/live-supervisor/wall-clock-timeout-test",
        "--scenario", "bot-only",
        "--target-outcome", "bot_match_committed",
        "--max-cycles", "1",
        "--max-wall-clock-seconds", "1",
        "--command-timeout-seconds", "900",
      ]);
      const plan = resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
        "logs/live-supervisor/wall-clock-timeout-test",
        "config/bot-testnet.json",
        "config/tester-testnet.json",
      ])) });
      const child = fakeHangingChild();

      const run = supervise(args, plan, {
        skipBuiltRuntimeCheck: true,
        commandKillGraceMs: 10,
        killProcess: (pid, signal) => {
          kills.push({ pid, signal });
          if (signal === "SIGKILL") {
            queueMicrotask(() => child.emit("close", null, "SIGKILL"));
          }
        },
        spawnCommand: ((_command: string, commandArgs: string[]) => isPreflightCommand(commandArgs) ? fakeSuccessfulPreflightChild() : child) as never,
        spawnSyncCommand: ignoredChecker(true) as never,
        lstat: missingStat,
        stat: missingStat,
        mkdir: () => Promise.resolve(undefined),
        realpath: (path) => Promise.resolve(pathToString(path)),
        appendFile: (path, text) => {
          const key = pathToString(path);
          writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
          return Promise.resolve();
        },
        writeFile: (path, text) => {
          writes.set(pathToString(path), textToString(text));
          return Promise.resolve();
        },
      });

      await vi.advanceTimersByTimeAsync(1010);

      await expect(run).resolves.toBe(2);
      expect(kills).toEqual([
        { pid: -1234, signal: "SIGTERM" },
        { pid: -1234, signal: "SIGKILL" },
      ]);
      const incident = jsonArtifact(writes, "/repo/logs/live-supervisor/wall-clock-timeout-test/cycle-0001-incident.json");
      expect(recordAt(incident["classification"], "incident classification")).toMatchObject({
        outcome: "command_timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not spawn actor commands when wall-clock expires at the command boundary", async () => {
    const writes = new Map<string, string>();
    const spawned: string[][] = [];
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/wall-clock-boundary-test",
      "--scenario", "bot-only",
      "--target-outcome", "bot_match_committed",
      "--max-cycles", "1",
      "--max-wall-clock-seconds", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
      "logs/live-supervisor/wall-clock-boundary-test",
      "config/bot-testnet.json",
      "config/tester-testnet.json",
    ])) });
    const clock = [0, 999, 1000, 1000];

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      now: () => clock.shift() ?? 1000,
      spawnCommand: ((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        return fakeChild("should not run");
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      lstat: missingStat,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      realpath: (path) => Promise.resolve(pathToString(path)),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(2);
    expect(spawned).toEqual([]);
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/wall-clock-boundary-test/summary.json");
    expect(summary).toMatchObject({ stopped: "unmet_coverage_goal" });
  });

  it("retries retryable preflight transport failures once before actor execution", async () => {
    const writes = new Map<string, string>();
    const spawned: string[][] = [];
    let preflightRuns = 0;
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/preflight-retry-test",
      "--scenario", "bot-only",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
      "logs/live-supervisor/preflight-retry-test",
      "config/bot-testnet.json",
      "config/tester-testnet.json",
    ])) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        if (isPreflightCommand(commandArgs)) {
          preflightRuns += 1;
          return preflightRuns === 1
            ? fakeChild("", 1, "Live preflight retryable failure: fetch failed\n")
            : fakeSuccessfulPreflightChild();
        }
        return fakeChild(JSON.stringify(botEvent("bot.decision.skipped", {
          reason: "no_actions",
          actions: emptyActions(),
        })));
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      lstat: missingStat,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      realpath: (path) => Promise.resolve(pathToString(path)),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(0);
    expect(spawned.filter((args) => isPreflightCommand(args))).toHaveLength(2);
    expect(spawned.filter((args) => !isPreflightCommand(args))).toHaveLength(1);
    expect(writes.has("/repo/logs/live-supervisor/preflight-retry-test/cycle-0001-bot-preflight-attempt-1.stdout.json")).toBe(true);
    expect(writes.has("/repo/logs/live-supervisor/preflight-retry-test/cycle-0001-bot-preflight-attempt-1.stdout.ndjson")).toBe(false);
    expect(writes.has("/repo/logs/live-supervisor/preflight-retry-test/cycle-0001-bot-preflight-attempt-2.stdout.json")).toBe(true);
    expect(writes.has("/repo/logs/live-supervisor/preflight-retry-test/cycle-0001-bot-preflight-attempt-1.command.json")).toBe(true);
    expect(writes.has("/repo/logs/live-supervisor/preflight-retry-test/cycle-0001-bot-preflight-attempt-2.command.json")).toBe(true);
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/preflight-retry-test/summary.json");
    expect(recordAt(summary["aggregateCounts"], "summary aggregate counts")).toMatchObject({ bot_no_action_skip: 1 });
  });

  it("writes retryable-looking preflight output as public producer artifacts", async () => {
    const writes = new Map<string, string>();
    const spawned: string[][] = [];
    const preflightOutput = JSON.stringify({ diagnostic: "public preflight output" });
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/preflight-unsafe-retry-test",
      "--scenario", "bot-only",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
      "logs/live-supervisor/preflight-unsafe-retry-test",
      "config/bot-testnet.json",
      "config/tester-testnet.json",
    ])) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        return fakeChild(preflightOutput, 1, "Live preflight retryable failure: fetch failed\n");
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      lstat: missingStat,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      realpath: (path) => Promise.resolve(pathToString(path)),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(2);
    expect(spawned.filter((args) => isPreflightCommand(args))).toHaveLength(2);
    expect(spawned.filter((args) => !isPreflightCommand(args))).toHaveLength(0);
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/preflight-unsafe-retry-test/summary.json");
    expect(summary).toMatchObject({ stopped: "preflight_retryable_error" });
    expect(recordAt(summary["aggregateCounts"], "summary aggregate counts")).toMatchObject({ preflight_retryable_error: 1 });
    expect(writes.get("/repo/logs/live-supervisor/preflight-unsafe-retry-test/cycle-0001-bot-preflight-attempt-1.stdout.json")).toBe(
      `${preflightOutput}\n`,
    );
    expect(writes.get("/repo/logs/live-supervisor/preflight-unsafe-retry-test/cycle-0001-bot-preflight-attempt-2.stdout.json")).toBe(
      `${preflightOutput}\n`,
    );
  });

  it("does not retry preflight after the wall-clock budget expires", async () => {
    const writes = new Map<string, string>();
    const spawned: string[][] = [];
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/preflight-retry-wall-clock-test",
      "--scenario", "bot-only",
      "--target-outcome", "bot_match_committed",
      "--max-cycles", "1",
      "--max-wall-clock-seconds", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
      "logs/live-supervisor/preflight-retry-wall-clock-test",
      "config/bot-testnet.json",
      "config/tester-testnet.json",
    ])) });
    const clock = [0, 0, 0, 0, 2000];

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      now: () => clock.shift() ?? 2000,
      spawnCommand: ((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        return fakeChild("", 1, "Live preflight retryable failure: fetch failed\n");
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      lstat: missingStat,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      realpath: (path) => Promise.resolve(pathToString(path)),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(2);
    expect(spawned.filter((args) => isPreflightCommand(args))).toHaveLength(1);
    expect(spawned.filter((args) => !isPreflightCommand(args))).toHaveLength(0);
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/preflight-retry-wall-clock-test/summary.json");
    expect(summary).toMatchObject({ stopped: "unmet_coverage_goal" });
    expect(writes.has("/repo/logs/live-supervisor/preflight-retry-wall-clock-test/cycle-0001-bot-preflight-attempt-1.command.json")).toBe(true);
  });

  it("caps actor command timers to Node's maximum delay", async () => {
    vi.useFakeTimers();
    try {
      const maxTimerDelayMs = 2_147_483_647;
      const writes = new Map<string, string>();
      const kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      const args = parseArgs([
        "--out-dir", "logs/live-supervisor/timeout-cap-test",
        "--scenario", "bot-only",
        "--target-outcome", "bot_match_committed",
        "--max-cycles", "1",
        "--command-timeout-seconds", String(maxTimerDelayMs),
      ]);
      const plan = resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
        "logs/live-supervisor/timeout-cap-test",
        "config/bot-testnet.json",
        "config/tester-testnet.json",
      ])) });
      const child = fakeHangingChild();

      const run = supervise(args, plan, {
        skipBuiltRuntimeCheck: true,
        commandKillGraceMs: maxTimerDelayMs + 10,
        killProcess: (pid, signal) => {
          kills.push({ pid, signal });
          if (signal === "SIGKILL") {
            queueMicrotask(() => child.emit("close", null, "SIGKILL"));
          }
        },
        spawnCommand: ((_command: string, commandArgs: string[]) => isPreflightCommand(commandArgs) ? fakeSuccessfulPreflightChild() : child) as never,
        spawnSyncCommand: ignoredChecker(true) as never,
        lstat: missingStat,
        stat: missingStat,
        mkdir: () => Promise.resolve(undefined),
        realpath: (path) => Promise.resolve(pathToString(path)),
        appendFile: (path, text) => {
          const key = pathToString(path);
          writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
          return Promise.resolve();
        },
        writeFile: (path, text) => {
          writes.set(pathToString(path), textToString(text));
          return Promise.resolve();
        },
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(maxTimerDelayMs - 1);
      expect(kills).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(kills).toEqual([{ pid: -1234, signal: "SIGTERM" }]);
      await vi.advanceTimersByTimeAsync(maxTimerDelayMs);

      await expect(run).resolves.toBe(2);
      expect(kills).toEqual([
        { pid: -1234, signal: "SIGTERM" },
        { pid: -1234, signal: "SIGKILL" },
      ]);
      expect(writes.get("/repo/logs/live-supervisor/timeout-cap-test/cycle-0001-incident.json")).toContain(
        "command_timeout",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("scenario planning", () => {
  it("prefers under-covered safe outcomes", () => {
    const ledger = createCoverageLedger(["tester_order_created", "bot_match_committed"]);
    recordOutcome(ledger, "tester_order_created");

    const choice = chooseScenario({ scenario: "auto", targetOutcomes: [] }, ledger);

    expect(choice).toMatchObject({
      kind: "scenario",
      scenario: { name: "bot-only" },
      targetOutcomes: ["bot_match_committed"],
    });
  });

  it("rotates past attempted uncovered outcomes before retrying them", () => {
    const ledger = createCoverageLedger(["tester_order_created", "bot_no_action_skip"]);
    const first = chooseScenario({ scenario: "auto", targetOutcomes: [] }, ledger);
    recordScenarioAttempt(ledger, 1, first);

    const second = chooseScenario({ scenario: "auto", targetOutcomes: [] }, ledger);

    expect(first).toMatchObject({
      kind: "scenario",
      targetOutcomes: ["tester_order_created"],
    });
    expect(second).toMatchObject({
      kind: "scenario",
      scenario: { name: "bot-only" },
      targetOutcomes: ["bot_no_action_skip"],
    });
  });

  it("prefers unattempted scenarios before retrying the same scenario for a new target", () => {
    const ledger = createCoverageLedger(["tester_order_created", "tester_sampled_too_small_skip"]);
    const first = chooseScenario({ scenario: "auto", targetOutcomes: [] }, ledger);
    recordScenarioAttempt(ledger, 1, first);

    const second = chooseScenario({ scenario: "auto", targetOutcomes: [] }, ledger);

    expect(second).toMatchObject({
      kind: "scenario",
      scenario: { name: "standard-cycle" },
      targetOutcomes: ["tester_sampled_too_small_skip"],
    });
  });

  it("reports unsupported explicit scenario goals", () => {
    const ledger = createCoverageLedger(["wrong_chain"]);
    const choice = chooseScenario({ scenario: "bot-only", targetOutcomes: ["wrong_chain"] }, ledger);

    expect(choice).toMatchObject({
      kind: "unsupported",
      requested: "wrong_chain",
    });
  });

  it("uses explicit scenario targets when no target outcome is supplied", () => {
    const ledger = createCoverageLedger(["tester_order_created", "bot_match_committed"]);
    const choice = chooseScenario({ scenario: "bot-only", targetOutcomes: [] }, ledger);

    expect(choice).toMatchObject({
      kind: "scenario",
      scenario: { name: "bot-only" },
      targetOutcomes: ["bot_no_action_skip"],
    });
  });

  it("auto-plans fresh order skip targets through the two-pass scenario", () => {
    const ledger = createCoverageLedger(["tester_fresh_order_skip"]);
    const choice = chooseScenario({ scenario: "auto", targetOutcomes: ["tester_fresh_order_skip"] }, ledger);

    expect(choice).toMatchObject({
      kind: "scenario",
      scenario: { name: "tester-fresh-skip-two-pass" },
      targetOutcomes: ["tester_fresh_order_skip"],
    });
  });

  it("records unsupported explicit goals as full terminal classifications", async () => {
    const writes = new Map<string, string>();
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/unsupported-test",
      "--scenario", "bot-only",
      "--target-outcome", "wrong_chain",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
      "logs/live-supervisor/unsupported-test",
      "config/bot-testnet.json",
      "config/tester-testnet.json",
    ])) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(2);
    const incident = jsonArtifact(writes, "/repo/logs/live-supervisor/unsupported-test/cycle-0001-incident.json");
    const classification = recordAt(incident["classification"], "incident classification");
    expect(classification).toMatchObject({ actor: "preflight", outcome: "unsupported_scenario", terminal: true });
    expect(classification["txHashes"]).toEqual([]);
    expect(recordAt(classification["evidence"], "incident classification evidence")).toMatchObject({
      recordsAccepted: 0,
      ignoredLineCount: 0,
      malformedLineCount: 0,
      exitStatus: null,
      signal: null,
      timedOut: false,
    });
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/unsupported-test/summary.json");
    expect(recordAt(summary["aggregateCounts"], "summary aggregate counts")).toMatchObject({ unsupported_scenario: 1 });
  });

  it("plans remaining target outcomes after earlier targets are covered", () => {
    const ledger = createCoverageLedger(["bot_no_action_skip", "bot_match_committed"]);
    recordOutcome(ledger, "bot_no_action_skip");
    const choice = chooseScenario({
      scenario: "auto",
      targetOutcomes: ["bot_no_action_skip", "bot_match_committed"],
    }, ledger);

    expect(choice).toMatchObject({
      kind: "scenario",
      targetOutcomes: ["bot_match_committed"],
    });
  });
});

describe("deterministic incident handling", () => {
  it("treats unmet explicit target outcomes at max cycles as logical incidents", async () => {
    const writes = new Map<string, string>();
    const spawned: Array<{ command: string; args: string[] }> = [];
    const args = parseArgs([
      "--bot-config", "config/bot-testnet.json",
      "--tester-config", "config/tester-testnet.json",
      "--out-dir", "logs/live-supervisor/unmet-coverage-test",
      "--scenario", "bot-only",
      "--target-outcome", "bot_match_committed",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((command: string, commandArgs: string[]) => {
        spawned.push({ command, args: commandArgs });
        if (isPreflightCommand(commandArgs)) {
          return fakeSuccessfulPreflightChild();
        }
        return fakeChild(JSON.stringify(botEvent("bot.decision.skipped", {
            reason: "no_actions",
            actions: emptyActions(),
        })));
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(2);
    expect(spawned.filter((item) => !isPreflightCommand(item.args)).map((item) => item.command)).toEqual([process.execPath]);
    const incident = jsonArtifact(writes, "/repo/logs/live-supervisor/unmet-coverage-test/cycle-0001-incident.json");
    expect(incident).toMatchObject({ unmetGoals: ["bot_match_committed"] });
    const incidentArtifacts = stringArrayAt(incident["artifacts"], "incident artifacts");
    expect(incidentArtifacts).toContain("logs/live-supervisor/unmet-coverage-test/cycle-0001-bot.stdout.ndjson");
    expect(incidentArtifacts).toContain("logs/live-supervisor/unmet-coverage-test/cycle-0001-bot.stderr.log");
    expect(incidentArtifacts).toContain("logs/live-supervisor/unmet-coverage-test/cycle-0001-bot.command.json");
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/unmet-coverage-test/summary.json");
    expect(summary).toMatchObject({ stopped: "unmet_coverage_goal" });
    const summaryArtifacts = stringArrayAt(summary["artifacts"], "summary artifacts");
    expect(summaryArtifacts).toContain("logs/live-supervisor/unmet-coverage-test/cycle-0001-bot.stdout.ndjson");
    expect(summaryArtifacts).toContain("logs/live-supervisor/unmet-coverage-test/cycle-0001-bot.stderr.log");
    expect(summaryArtifacts).toContain("logs/live-supervisor/unmet-coverage-test/cycle-0001-bot.command.json");
  });

  it("treats unmet explicit target outcomes at max wall-clock as logical incidents", async () => {
    const writes = new Map<string, string>();
    const args = parseArgs([
      "--bot-config", "config/bot-testnet.json",
      "--tester-config", "config/tester-testnet.json",
      "--out-dir", "logs/live-supervisor/unmet-wall-clock-test",
      "--scenario", "bot-only",
      "--target-outcome", "bot_match_committed",
      "--max-wall-clock-seconds", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });
    const clock = [0, 2000];

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      now: () => clock.shift() ?? 2000,
      spawnCommand: (() => {
        throw new Error("actor should not start after wall-clock expiry");
      }),
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(2);
    const incident = jsonArtifact(writes, "/repo/logs/live-supervisor/unmet-wall-clock-test/cycle-0001-incident.json");
    expect(incident).toMatchObject({ unmetGoals: ["bot_match_committed"] });
    expect(recordAt(incident["classification"], "incident classification")).toMatchObject({
      actor: "preflight",
      outcome: "unmet_coverage_goal",
      terminal: true,
      reason: "bounded wall-clock budget ended before observing requested outcomes: bot_match_committed",
    });
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/unmet-wall-clock-test/summary.json");
    expect(summary).toMatchObject({ stopped: "unmet_coverage_goal" });
    expect(recordAt(summary["aggregateCounts"], "summary aggregate counts")).toMatchObject({ unmet_coverage_goal: 1 });
  });

  it("uses the last attempted cycle for wall-clock unmet coverage incidents", async () => {
    const writes = new Map<string, string>();
    const args = parseArgs([
      "--bot-config", "config/bot-testnet.json",
      "--tester-config", "config/tester-testnet.json",
      "--out-dir", "logs/live-supervisor/unmet-wall-clock-after-cycle-test",
      "--scenario", "bot-only",
      "--target-outcome", "bot_match_committed",
      "--max-wall-clock-seconds", "1",
      "--max-cycles", "2",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });
    const clock = [0, 0, 0, 0, 0, 0, 0, 2000];

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      now: () => clock.shift() ?? 2000,
      spawnCommand: ((_command: string, commandArgs: string[]) => isPreflightCommand(commandArgs) ? fakeSuccessfulPreflightChild() : fakeChild(JSON.stringify(botEvent("bot.decision.skipped", {
        reason: "no_actions",
        actions: emptyActions(),
      })))) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(2);
    const incident = jsonArtifact(writes, "/repo/logs/live-supervisor/unmet-wall-clock-after-cycle-test/cycle-0001-incident.json");
    expect(incident).toMatchObject({ cycleIndex: 1, unmetGoals: ["bot_match_committed"] });
    expect(writes.has("/repo/logs/live-supervisor/unmet-wall-clock-after-cycle-test/cycle-0002-incident.json")).toBe(false);
  });

  it("does not start another command after the wall-clock budget expires mid-cycle", async () => {
    const writes = new Map<string, string>();
    const spawned: string[][] = [];
    const args = parseArgs([
      "--bot-config", "config/bot-testnet.json",
      "--tester-config", "config/tester-testnet.json",
      "--out-dir", "logs/live-supervisor/mid-cycle-wall-clock-test",
      "--scenario", "standard-cycle",
      "--target-outcome", "bot_match_committed",
      "--max-wall-clock-seconds", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });
    const clock = [0, 0, 0, 0, 0, 2000];

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      now: () => clock.shift() ?? 2000,
      spawnCommand: ((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        return fakeSuccessfulPreflightChild();
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(2);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toContain("tester-1");
    const incident = jsonArtifact(writes, "/repo/logs/live-supervisor/mid-cycle-wall-clock-test/cycle-0001-incident.json");
    expect(incident).toMatchObject({ cycleIndex: 1, unmetGoals: ["bot_match_committed"] });
  });

  it("treats repeated target outcomes as one explicit contract", async () => {
    const writes = new Map<string, string>();
    const args = parseArgs([
      "--bot-config", "config/bot-testnet.json",
      "--tester-config", "config/tester-testnet.json",
      "--out-dir", "logs/live-supervisor/mixed-contract-test",
      "--scenario", "bot-only",
      "--target-outcome", "bot_no_action_skip",
      "--target-outcome", "bot_match_committed",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[]) => isPreflightCommand(commandArgs) ? fakeSuccessfulPreflightChild() : fakeChild(JSON.stringify(botEvent("bot.decision.skipped", {
        reason: "no_actions",
        actions: emptyActions(),
      })))) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(2);
    expect(writes.get("/repo/logs/live-supervisor/mixed-contract-test/cycle-0001-incident.json")).toContain("bot_match_committed");
    expect(writes.get("/repo/logs/live-supervisor/mixed-contract-test/summary.json")).toContain("unmet_coverage_goal");
  });

  it("uses explicit target outcomes as coverage ledger goals", async () => {
    const writes = new Map<string, string>();
    const args = parseArgs([
      "--bot-config", "config/bot-testnet.json",
      "--tester-config", "config/tester-testnet.json",
      "--out-dir", "logs/live-supervisor/target-ledger-test",
      "--scenario", "tester-only",
      "--target-outcome", "tester_estimated_too_small_skip",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[]) => isPreflightCommand(commandArgs) ? fakeSuccessfulPreflightChild() : fakeChild(JSON.stringify({
        startTime: "now",
        actions: { newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" }, cancelledOrders: 0 },
        txHash: txHash("66"),
        ElapsedSeconds: 1,
      }))) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(2);
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/target-ledger-test/summary.json");
    expect(recordAt(summary["coverage"], "coverage")["goals"]).toEqual(["tester_estimated_too_small_skip"]);
    expect(summary).toMatchObject({ txCreatingTxHashCount: 1, txCreatingOutcomeCount: 1 });
  });

  it("keeps successful preflight probes out of aggregate outcome counts", async () => {
    const writes = new Map<string, string>();
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/preflight-summary-test",
      "--scenario", "bot-only",
      "--target-outcome", "bot_no_action_skip",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
      "logs/live-supervisor/preflight-summary-test",
      "config/bot-testnet.json",
      "config/tester-testnet.json",
    ])) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[]) => isPreflightCommand(commandArgs) ? fakeSuccessfulPreflightChild() : fakeChild(JSON.stringify(botEvent("bot.decision.skipped", {
        reason: "no_actions",
        actions: emptyActions(),
      })))) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: () => Promise.resolve(),
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(0);
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/preflight-summary-test/summary.json");
    expect(recordAt(summary["aggregateCounts"], "summary aggregate counts")).toEqual({ bot_no_action_skip: 1 });
  });

  it("summarizes safe preflight balances and selected tester scenario", async () => {
    const writes = new Map<string, string>();
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/preflight-state-summary-test",
      "--scenario", "tester-fresh-skip-two-pass",
      "--target-outcome", "tester_order_created",
      "--stop-after-tx-count", "1",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
      "logs/live-supervisor/preflight-state-summary-test",
      "config/bot-testnet.json",
      "config/tester-testnet.json",
    ])) });

    let testerRuns = 0;
    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[]) => isPreflightCommand(commandArgs)
        ? fakePreflightChild({ ckbAvailable: "2853.99897309", ickbAvailable: "250838.31219989" })
        : fakeChild(JSON.stringify((testerRuns += 1) === 1
          ? {
              startTime: "now",
              actions: {
                requestedTesterScenario: "multi-order-limit-orders",
                testerScenario: "two-ickb-to-ckb-limit-orders",
                newOrders: [
                  { giveIckb: "10", takeCkb: "9", fee: "0.1" },
                  { giveIckb: "10", takeCkb: "9", fee: "0.1" },
                ],
                orderCount: 2,
                cancelledOrders: 0,
              },
              txHash: txHash("81"),
              ElapsedSeconds: 1,
            }
          : { skip: { reason: "fresh-matchable-order", txHash: txHash("81") } }))) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: () => Promise.resolve(),
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(0);
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/preflight-state-summary-test/summary.json");
    expect(summary["preflightState"]).toEqual([
      {
        cycleIndex: 1,
        actor: "tester",
        step: "tester-pass-1",
        selectedTesterScenario: "auto",
        balances: {
          CKB: { available: "2853.99897309" },
          ICKB: { available: "250838.31219989" },
        },
      },
      {
        cycleIndex: 1,
        actor: "tester",
        step: "tester-pass-2",
        selectedTesterScenario: "auto",
        balances: {
          CKB: { available: "2853.99897309" },
          ICKB: { available: "250838.31219989" },
        },
      },
    ]);
  });

  it("keeps default coverage goals best-effort at max cycles", async () => {
    let spawnCount = 0;
    const writes = new Map<string, string>();
    const args = parseArgs([
      "--out-dir", "logs/live-supervisor/default-coverage-test",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: selectiveIgnoredChecker(new Set([
      "logs/live-supervisor/default-coverage-test",
      "config/bot-testnet.json",
      "config/tester-testnet.json",
    ])) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[]) => {
        if (isPreflightCommand(commandArgs)) {
          return fakeSuccessfulPreflightChild();
        }
        spawnCount += 1;
        return fakeChild(spawnCount === 1
          ? JSON.stringify({
            startTime: "now",
            actions: { newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" }, cancelledOrders: 0 },
            txHash: txHash("55"),
            ElapsedSeconds: 1,
          })
          : JSON.stringify(botEvent("bot.decision.skipped", {
            reason: "no_actions",
            actions: emptyActions(),
          })));
      }) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(0);
  });

  it("treats stop-after-tx-count as a successful operator stop", async () => {
    const writes = new Map<string, string>();
    const args = parseArgs([
      "--bot-config", "config/bot-testnet.json",
      "--tester-config", "config/tester-testnet.json",
      "--out-dir", "logs/live-supervisor/stop-after-tx-test",
      "--scenario", "tester-only",
      "--target-outcome", "tester_fresh_order_skip",
      "--stop-after-tx-count", "1",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[]) => isPreflightCommand(commandArgs) ? fakeSuccessfulPreflightChild() : fakeChild(JSON.stringify({
        startTime: "now",
        actions: { newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" }, cancelledOrders: 0 },
        txHash: txHash("44"),
        ElapsedSeconds: 1,
      }))) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(0);
    expect([...writes.keys()].some((path) => path.endsWith("incident.json"))).toBe(false);
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/stop-after-tx-test/summary.json");
    expect(summary).toMatchObject({
      stopped: "stop_after_tx_count",
      txCreatingTxHashCount: 1,
      txCreatingOutcomeCount: 1,
      testerOrderEvidence: [
        {
          outcome: "tester_order_created",
          txHashes: [txHash("44")],
          orderCount: 1,
          cancelledOrders: 0,
          orders: [{ direction: "ckb-to-ickb", giveCkb: "10", takeIckb: "9", fee: "0.1", dust: false }],
        },
      ],
    });
  });

  it("does not count skip reference hashes toward stop-after-tx-count", async () => {
    const writes = new Map<string, string>();
    const args = parseArgs([
      "--bot-config", "config/bot-testnet.json",
      "--tester-config", "config/tester-testnet.json",
      "--out-dir", "logs/live-supervisor/skip-hash-stop-test",
      "--scenario", "tester-only",
      "--target-outcome", "tester_fresh_order_skip",
      "--stop-after-tx-count", "1",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[]) => isPreflightCommand(commandArgs) ? fakeSuccessfulPreflightChild() : fakeChild(JSON.stringify({
        skip: { reason: "fresh-matchable-order", txHash: txHash("44") },
      }))) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(0);
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/skip-hash-stop-test/summary.json");
    expect(summary).toMatchObject({ stopped: "max_cycles", txCreatingTxHashCount: 0, txCreatingOutcomeCount: 0 });
    expect(recordAt(summary["txHashesByOutcome"], "summary tx hashes")).toEqual({
      tester_fresh_order_skip: [txHash("44")],
    });
  });

  it("counts matching top-level and nested transaction hashes once in summaries", async () => {
    const writes = new Map<string, string>();
    const args = parseArgs([
      "--bot-config", "config/bot-testnet.json",
      "--tester-config", "config/tester-testnet.json",
      "--out-dir", "logs/live-supervisor/dedup-tx-hash-summary-test",
      "--scenario", "bot-only",
      "--stop-after-tx-count", "1",
      "--max-cycles", "1",
    ]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      skipBuiltRuntimeCheck: true,
      spawnCommand: ((_command: string, commandArgs: string[]) => isPreflightCommand(commandArgs) ? fakeSuccessfulPreflightChild() : fakeChild([
        JSON.stringify(botEvent("bot.transaction.built", {
          actions: { collectedOrders: 0, completedDeposits: 0, matchedOrders: 1, deposits: 0, withdrawalRequests: 0, withdrawals: 0 },
        })),
        JSON.stringify(botEvent("bot.transaction.committed", {
          txHash: txHash("5c"),
          error: { txHash: txHash("5c") },
        })),
      ].join("\n"))) as never,
      spawnSyncCommand: ignoredChecker(true) as never,
      stat: missingStat,
      mkdir: () => Promise.resolve(undefined),
      appendFile: (path, text) => {
        const key = pathToString(path);
        writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
        return Promise.resolve();
      },
      writeFile: (path, text) => {
        writes.set(pathToString(path), textToString(text));
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(0);
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/dedup-tx-hash-summary-test/summary.json");
    expect(summary).toMatchObject({
      stopped: "stop_after_tx_count",
      txCreatingTxHashCount: 1,
      txCreatingOutcomeCount: 1,
    });
    expect(recordAt(summary["txHashesByOutcome"], "summary tx hashes")).toEqual({
      bot_match_committed: [txHash("5c")],
    });
  });

});

function commandResult(actor: "bot" | "tester" | "preflight", stdout: string): CommandResult {
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
    runId: "test",
    iterationId: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    type,
    ...fields,
  };
}

function emptyActions(): Record<string, number> {
  return {
    collectedOrders: 0,
    completedDeposits: 0,
    matchedOrders: 0,
    deposits: 0,
    withdrawalRequests: 0,
    withdrawals: 0,
  };
}

function txHash(byte: string): string {
  return `0x${byte.repeat(32)}`;
}

function ignoredChecker(ignored: boolean): () => { status: number } {
  return () => ({ status: ignored ? 0 : 1 });
}

function selectiveIgnoredChecker(ignoredPaths: Set<string>): (_command: string, args: string[]) => { status: number } {
  return (_command, args) => ({ status: ignoredPaths.has(args.at(-1) ?? "") ? 0 : 1 });
}

function isPreflightCommand(args: string[]): boolean {
  return args[0] === "scripts/ickb-live-preflight.mjs";
}

function fakeSuccessfulPreflightChild(): ReturnType<typeof fakeChild> {
  return fakeChild(JSON.stringify({ chain: "testnet", bounded: true, maxIterations: 1 }));
}

function fakePreflightChild({ ckbAvailable, ickbAvailable }: { ckbAvailable: string; ickbAvailable: string }): ReturnType<typeof fakeChild> {
  return fakeChild(JSON.stringify({
    chain: "testnet",
    bounded: true,
    maxIterations: 1,
    balances: {
      CKB: { available: ckbAvailable },
      ICKB: { available: ickbAvailable },
    },
  }));
}

function fakeChild(stdout: string, status = 0): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => boolean;
};
function fakeChild(stdout: string, status: number, stderr: string): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => boolean;
};
function fakeChild(stdout: string, status = 0, stderr = ""): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => boolean;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (): boolean => true;
  queueMicrotask(() => {
    child.stdout.emit("data", Buffer.from(`${stdout}\n`));
    if (stderr !== "") {
      child.stderr.emit("data", Buffer.from(stderr));
    }
    child.emit("close", status, null);
  });
  return child;
}

function fakeHangingChild(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  kill: (signal?: NodeJS.Signals) => boolean;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number;
    kill: (signal?: NodeJS.Signals) => boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 1234;
  child.kill = (signal = "SIGTERM"): boolean => {
    if (signal === "SIGKILL") {
      queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    }
    return true;
  };
  return child;
}

function missingStat(): never {
  const error = new Error("missing") as NodeJS.ErrnoException;
  error.code = "ENOENT";
  throw error;
}

function jsonArtifact(writes: Map<string, string>, path: string): Record<string, unknown> {
  const text = writes.get(path);
  if (text === undefined) {
    throw new Error(`Missing artifact: ${path}`);
  }
  const parsed: unknown = JSON.parse(text);
  return recordAt(parsed, path);
}

function recordAt(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`Expected record: ${label}`);
}

function stringArrayAt(value: unknown, label: string): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  throw new Error(`Expected string array: ${label}`);
}

function pathToString(path: unknown): string {
  if (typeof path === "string") {
    return path;
  }
  if (Buffer.isBuffer(path)) {
    return path.toString("utf8");
  }
  if (path instanceof URL) {
    return path.toString();
  }
  throw new TypeError("Unexpected artifact path type");
}

function textToString(text: unknown): string {
  if (typeof text === "string") {
    return text;
  }
  if (ArrayBuffer.isView(text)) {
    return Buffer.from(text.buffer, text.byteOffset, text.byteLength).toString("utf8");
  }
  throw new TypeError("Unexpected artifact text type");
}
