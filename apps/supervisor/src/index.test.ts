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
  safeArtifactText,
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

  it("rejects old LLM command-shape and repair mode flags", () => {
    expect(() => parseArgs(["--llm-bin", "custom-llm"])).toThrow("Unknown argument: --llm-bin");
    expect(() => parseArgs(["--llm-command", "custom-llm"])).toThrow("Unknown argument: --llm-command");
    expect(() => parseArgs(["--llm-arg", "repair"])).toThrow("Unknown argument: --llm-arg");
    expect(() => parseArgs(["--llm-on-incident"])).toThrow("Unknown argument: --llm-on-incident");
    expect(() => parseArgs(["--no-llm-on-incident"])).toThrow("Unknown argument: --no-llm-on-incident");
    expect(() => parseArgs(["--llm-timeout-seconds", "60"])).toThrow("Unknown argument: --llm-timeout-seconds");
    expect(() => parseArgs(["--llm-max-attempts", "2"])).toThrow("Unknown argument: --llm-max-attempts");
    expect(() => parseArgs(["--max-repair-rounds", "1"])).toThrow("Unknown argument: --max-repair-rounds");
    expect(() => parseArgs(["--autonomous-repair"])).toThrow("Unknown argument: --autonomous-repair");
    expect(() => parseArgs(["--repair-commit-message", "repair test"])).toThrow("Unknown argument: --repair-commit-message");
    expect(() => parseArgs(["--coverage-goal", "bot_match_committed"])).toThrow("Unknown argument: --coverage-goal");
    expect(() => parseArgs(["--stop-on", "unmet_coverage_goal"])).toThrow("Unknown argument: --stop-on");
    expect(() => parseArgs(["--force"])).toThrow("Unknown argument: --force");
    expect(() => parseArgs(["--verify-command", "pnpm test"])).toThrow("Unknown argument: --verify-command");
    expect(() => parseArgs(["--expected-chain", "mainnet"])).toThrow("Unknown argument: --expected-chain");
    expect(() => parseArgs(["--no-preflight"])).toThrow("Unknown argument: --no-preflight");
  });

  it("refuses non-ignored output paths", () => {
    const args = parseArgs(["--dry-run", "--out-dir", "not-ignored"]);

    expect(() => resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(false) })).toThrow(
      "Supervisor output directory must be under logs/live-supervisor/",
    );
  });

  it("refuses ignored output paths outside the supervisor artifact root", () => {
    const args = parseArgs(["--dry-run", "--out-dir", "config/supervisor"]);

    expect(() => resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) })).toThrow(
      "Supervisor output directory must be under logs/live-supervisor/",
    );
  });

  it("resolves ignored dry-run artifact paths without configs", () => {
    const args = parseArgs(["--dry-run", "--out-dir", "logs/live-supervisor/test"]);
    const plan = resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) });

    expect(plan.relativeOutDir).toBe("logs/live-supervisor/test");
    expect(plan.botConfigPath).toBeUndefined();
    expect(plan.testerConfigPath).toBeUndefined();
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
      expect(actor?.env).toMatchObject({ BOT_CONFIG_FILE: "/repo/config/bot-testnet.json", INIT_CWD: "/repo" });
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

  it("runs the same tester twice for fresh-skip multi-order coverage", async () => {
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
                requestedTesterScenario: "multi-order-limit-orders",
                testerScenario: "mixed-direction-limit-orders",
                newOrders: [
                  { giveCkb: "10", takeIckb: "9", fee: "0.1" },
                  { giveIckb: "20", takeCkb: "18", fee: "0.2" },
                ],
                orderCount: 2,
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
    expect(testerSpawns[0]?.env).toMatchObject({ TESTER_SCENARIO: "multi-order-limit-orders" });
    expect(testerSpawns[1]?.env).toMatchObject({ TESTER_SCENARIO: "auto" });
    expect(writes.has("/repo/logs/live-supervisor/two-pass-test/cycle-0001-tester-pass-1.stdout.ndjson")).toBe(true);
    expect(writes.has("/repo/logs/live-supervisor/two-pass-test/cycle-0001-tester-pass-2.stdout.ndjson")).toBe(true);
    const summary = jsonArtifact(writes, "/repo/logs/live-supervisor/two-pass-test/summary.json");
    expect(recordAt(summary["aggregateCounts"], "summary aggregate counts")).toMatchObject({
      tester_order_created: 1,
      tester_fresh_order_skip: 1,
    });
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
        cancelledOrders: 0,
      },
      txHash: txHash("15"),
      ElapsedSeconds: 1,
    }));

    expect(classifyActorResult("tester", result, { scenario: "ickb-to-ckb-limit-order" })).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
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
      readyPoolDepositCount: 2,
      nearReadyPoolDepositCount: 1,
      futurePoolDepositCount: 3,
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

  it("keeps tester confirmation timeouts classified by safety evidence despite exit code 2", () => {
    const result = {
      ...commandResult("tester", JSON.stringify({
        txHash: txHash("aa"),
        error: {
          name: "TransactionConfirmationError",
          message: "Transaction confirmation timed out",
          txHash: txHash("aa"),
          status: "sent",
        },
      })),
      status: 2,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "confirmation_timeout",
      terminal: true,
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

  it("safety classifications override ordinary exits", () => {
    expect(classifyActorResult("bot", commandResult("bot", "{not-json}"))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
    });
    expect(classifyActorResult("bot", commandResult("bot", JSON.stringify({ privateKey: "0xsecret" })))).toMatchObject({
      outcome: "secret_leak_sentinel",
      terminal: true,
    });
    expect(classifyActorResult("bot", { ...commandResult("bot", ""), timedOut: true })).toMatchObject({
      outcome: "command_timeout",
      terminal: true,
    });
  });

  it("classifies terminal preflight safety failures before launch", () => {
    expect(classifyActorResult("preflight", { ...commandResult("preflight", ""), timedOut: true })).toMatchObject({
      outcome: "command_timeout",
      terminal: true,
    });
    expect(classifyActorResult("preflight", commandResult("preflight", JSON.stringify({
      privateKey: "0xsecret",
    })))).toMatchObject({
      outcome: "secret_leak_sentinel",
      terminal: true,
    });
  });

  it("sanitizes transaction-shaped preflight errors before classification reaches artifacts", () => {
    const classification = classifyActorResult("preflight", {
      ...commandResult("preflight", "{}"),
      status: 1,
      stderr: JSON.stringify({ witnesses: ["0xsignature"], inputs: [] }),
    });

    expect(classification.reason).toBe("<redacted: transaction-shaped output withheld by supervisor>\n");
  });

  it("withholds secret-shaped raw artifacts", () => {
    expect(safeArtifactText(JSON.stringify({ privateKey: "0xsecret" }))).toBe(
      "<redacted: secret-shaped output withheld by supervisor>\n",
    );
    expect(safeArtifactText(`PRIVATE_KEY=0x${"11".repeat(32)}`)).toBe(
      "<redacted: secret-shaped output withheld by supervisor>\n",
    );
    expect(safeArtifactText("SEED_PHRASE=alpha beta gamma")).toBe(
      "<redacted: secret-shaped output withheld by supervisor>\n",
    );
    expect(safeArtifactText("RPC_URL=https://user:pass@testnet.example/path?token=secret")).toBe(
      "<redacted: secret-shaped output withheld by supervisor>\n",
    );
    expect(safeArtifactText(JSON.stringify({ witnesses: ["0xsignature"], inputs: [] }))).toBe(
      "<redacted: transaction-shaped output withheld by supervisor>\n",
    );
    expect(safeArtifactText(JSON.stringify({ system: { tip: { hash: txHash("aa") } } }))).toBe(
      JSON.stringify({ system: { tip: { hash: txHash("aa") } } }),
    );
    expect(safeArtifactText(JSON.stringify({ app: "bot" }))).toBe(JSON.stringify({ app: "bot" }));
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
    expect(classification).toMatchObject({ actor: "preflight", outcome: "unknown", terminal: true });
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
    expect(recordAt(summary["aggregateCounts"], "summary aggregate counts")).toMatchObject({ unknown: 1 });
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
    expect([...writes.keys()].some((path) => path.includes(".llm"))).toBe(false);
    expect(summary).not.toHaveProperty("llmWorker");
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
    expect(writes.get("/repo/logs/live-supervisor/stop-after-tx-test/summary.json")).toContain("stop_after_tx_count");
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
    expect(summary).toMatchObject({ stopped: "max_cycles" });
    expect(recordAt(summary["txHashesByOutcome"], "summary tx hashes")).toEqual({
      tester_fresh_order_skip: [txHash("44")],
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
  return fakeChild(JSON.stringify({ chain: "testnet" }));
}

function fakeChild(stdout: string, status = 0): EventEmitter & {
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
