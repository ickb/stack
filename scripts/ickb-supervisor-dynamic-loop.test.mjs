import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseTesterScenario,
  DEFAULT_CHILD_TIMEOUT_SECONDS_VALUE as DEFAULT_SUPERVISOR_LOOP_CHILD_TIMEOUT_SECONDS,
  fixed8DecimalToUnits,
  parseArgs,
  runDynamicSupervisorLoop,
  usage,
} from "./ickb-supervisor-dynamic-loop.mjs";

test("dynamic supervisor loop parses options", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.deepEqual(parseArgs([
    "--tester-config", "config/custom.json",
    "--preflight-role", "tester-watch",
    "--log-root", "log/custom",
    "--session-root", "log/custom/validation/manual-session",
    "--max-chunks", "2",
    "--chunk-max-runs", "3",
    "--stable-limit", "99",
    "--chunk-backoff-seconds", "4",
    "--between-chunks-seconds", "5",
    "--child-timeout-seconds", "6",
    "--command-timeout-seconds", "7",
    "--chunk-timeout-seconds", "90",
    "--preflight-timeout-seconds", "9",
    "--preflight-script", "scripts/preflight.mjs",
    "--supervisor-loop-script", "scripts/loop.mjs",
  ]), {
    help: false,
    testerConfig: "config/custom.json",
    preflightRole: "tester-watch",
    logRoot: "log/custom",
    sessionRoot: "log/custom/validation/manual-session",
    maxChunks: 2,
    chunkMaxRuns: 3,
    stableLimit: 99,
    chunkBackoffSeconds: 4,
    betweenChunksSeconds: 5,
    childTimeoutSeconds: 6,
    commandTimeoutSeconds: 7,
    chunkTimeoutSeconds: 90,
    preflightTimeoutSeconds: 9,
    preflightScript: "scripts/preflight.mjs",
    supervisorLoopScript: "scripts/loop.mjs",
    supervisorArgs: [],
  });
  assert.deepEqual(parseArgs(["--", "--target-outcome", "bot_match_committed"]).supervisorArgs, [
    "--target-outcome",
    "bot_match_committed",
  ]);
  assert.equal(parseArgs([]).childTimeoutSeconds, DEFAULT_SUPERVISOR_LOOP_CHILD_TIMEOUT_SECONDS);
  assert.equal(
    parseArgs(["--chunk-max-runs", "3", "--child-timeout-seconds", "6", "--chunk-backoff-seconds", "4"]).chunkTimeoutSeconds,
    86,
  );
  assert.throws(
    () => parseArgs(["--chunk-max-runs", String(Number.MAX_SAFE_INTEGER), "--child-timeout-seconds", String(Number.MAX_SAFE_INTEGER)]),
    /Invalid derived --chunk-timeout-seconds: expected a safe integer/u,
  );
  assert.throws(() => parseArgs(["--max-chunks", "0"]), /Invalid --max-chunks/u);
  assert.throws(
    () => parseArgs(["--chunk-max-runs", "3", "--child-timeout-seconds", "6", "--chunk-backoff-seconds", "4", "--chunk-timeout-seconds", "85"]),
    /Invalid --chunk-timeout-seconds/u,
  );
  assert.throws(() => parseArgs(["--unknown"]), /Unknown argument/u);
  assert.throws(() => parseArgs(["--", "--out-dir", "log/validation/bad"]), /Do not pass supervisor --out-dir/u);
  assert.match(usage(), /tester-config/u);
  assert.match(usage(), /--log-root/u);
});

test("dynamic supervisor loop creates a default validation session root", async () => {
  const originalPrivateKey = process.env.PRIVATE_KEY;
  process.env.PRIVATE_KEY = "operator-secret";
  const writes = new Map();
  const appended = new Map();
  const commands = [];
  const output = { text: "", write(chunk) { this.text += chunk; } };
  try {
    const exitCode = await runDynamicSupervisorLoop({
      root: "/repo",
      argv: ["--max-chunks", "1"],
      io: { stdout: output, stderr: output },
      dependencies: {
        now: () => 1700000000123,
        pid: 4321,
        checkIgnored: (path) => path.startsWith("log/"),
        stat: missingStat,
        lstat: missingStat,
        mkdir: async () => undefined,
        writeFile: async (path, text) => writes.set(path, text),
        appendFile: async (path, text) => appended.set(path, (appended.get(path) ?? "") + text),
        spawnSync: (_command, args, options) => {
          commands.push({ args, options });
          if (args[0] === "scripts/ickb-live-preflight.mjs") {
            return { status: 0, signal: null, stdout: JSON.stringify({ balances: { CKB: { available: "3200" }, ICKB: { available: "0" } } }), stderr: "" };
          }
          return { status: 0, signal: null, stdout: "loop stopped reason=max_runs runs=1 out=log/validation/dynamic-1700000000-4321/chunks/chunk-0001\n", stderr: "" };
        },
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(writes.has("/repo/log/validation/dynamic-1700000000-4321/operator/launch.json"), true);
    assert.equal(appended.has("/repo/log/validation/dynamic-1700000000-4321/operator/events.ndjson"), true);
    assert.deepEqual(commands[1].args.slice(0, 3), [
      "scripts/ickb-supervisor-loop.mjs",
      "--out-root",
      "log/validation/dynamic-1700000000-4321/chunks/chunk-0001",
    ]);
    assert.equal(commands[0].options.env.NODE_OPTIONS, "--disable-warning=DEP0040");
    assert.equal(commands[1].options.env.NODE_OPTIONS, "--disable-warning=DEP0040");
    assert.equal(commands[0].options.env.PRIVATE_KEY, undefined);
    assert.equal(commands[1].options.env.PRIVATE_KEY, undefined);
    assert.match(output.text, /"type":"chunk_finished"/u);
    assert.match(output.text, /log\/validation\/dynamic-1700000000-4321\/chunks\/chunk-0001/u);
  } finally {
    if (originalPrivateKey === undefined) {
      delete process.env.PRIVATE_KEY;
    } else {
      process.env.PRIVATE_KEY = originalPrivateKey;
    }
  }
});

test("dynamic supervisor loop validates explicit session roots", async () => {
  const output = { text: "", write(chunk) { this.text += chunk; } };

  const outsideExit = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: ["--log-root", "log", "--session-root", "other/session", "--max-chunks", "1"],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      spawnSync: () => {
        throw new Error("should not spawn with invalid session root");
      },
    },
  });
  assert.equal(outsideExit, 1);
  assert.match(output.text, /--session-root must stay under --log-root/u);

  output.text = "";
  const badShapeExit = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: ["--log-root", "log", "--session-root", "log/manual-session", "--max-chunks", "1"],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      spawnSync: () => {
        throw new Error("should not spawn with invalid session root shape");
      },
    },
  });
  assert.equal(badShapeExit, 1);
  assert.match(output.text, /--session-root must be <log-root>\/validation\/<session>/u);

  output.text = "";
  const reusedExit = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: ["--log-root", "log", "--session-root", "log/validation/existing", "--max-chunks", "1"],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: async () => ({}),
      spawnSync: () => {
        throw new Error("should not spawn with reused session root");
      },
    },
  });
  assert.equal(reusedExit, 1);
  assert.match(output.text, /Validation session root already exists: log\/validation\/existing/u);
});

test("dynamic supervisor loop refuses symlinked session roots", async () => {
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: ["--log-root", "log", "--session-root", "log/validation/symlinked", "--max-chunks", "1"],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: async (path) => ({ isSymbolicLink: () => path === "/repo/log/validation" }),
      spawnSync: () => {
        throw new Error("should not spawn through symlinked session root");
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /Refusing to use session root through symlinked path: \/repo\/log\/validation/u);
});

test("dynamic supervisor loop chooses fundable tester scenarios", () => {
  const ckb = 100000000n;
  assert.equal(fixed8DecimalToUnits("1.00000001"), ckb + 1n);
  assert.equal(fixed8DecimalToUnits("bad"), undefined);
  assert.deepEqual(chooseTesterScenario({ ckb: 3001n * ckb, ickb: 0n }), {
    scenario: "all-ckb-limit-order",
    feeArgs: [],
  });
  assert.deepEqual(chooseTesterScenario({ ckb: 2100n * ckb, ickb: 1n }), {
    scenario: "ickb-to-ckb-limit-order",
    feeArgs: ["--tester-fee", "1", "--tester-fee-base", "1000"],
  });
  assert.deepEqual(chooseTesterScenario({ ckb: 2099n * ckb, ickb: 1n }), {
    scenario: "auto",
    feeArgs: [],
  });
});

test("dynamic supervisor loop runs selected bounded chunks", async () => {
  const commands = [];
  const sleeps = [];
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: [
      "--log-root", "log",
      "--session-root", "log/validation/test-session",
      "--max-chunks", "2",
      "--between-chunks-seconds", "0",
      "--",
      "--target-outcome", "bot_match_committed",
    ],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      appendFile: async () => undefined,
      spawnSync: (_command, args, options) => {
        commands.push({ args, options });
        if (args[0] === "scripts/ickb-live-preflight.mjs") {
          const stdout = commands.length === 1
            ? JSON.stringify({ balances: { CKB: { available: "3200" }, ICKB: { available: "0" } } })
            : JSON.stringify({ balances: { CKB: { available: "2100" }, ICKB: { available: "1" } } });
          return { status: 0, signal: null, stdout, stderr: "" };
        }
        return { status: 0, signal: null, stdout: "loop run=1 status=0 stopped=max_cycles outcomes=- tx=0 new=- stable=1 state=- decision=max_runs out=logs/live-supervisor/test\n", stderr: "" };
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(sleeps.length, 0);
  assert.equal(commands.length, 4);
  assert.equal(commands[1].args.includes("all-ckb-limit-order"), true);
  assert.equal(commands[3].args.includes("ickb-to-ckb-limit-order"), true);
  assert.deepEqual(commands[1].args.slice(0, 3), ["scripts/ickb-supervisor-loop.mjs", "--out-root", "log/validation/test-session/chunks/chunk-0001"]);
  const separator = commands[1].args.indexOf("--");
  assert.equal(commands[1].args.slice(0, separator).includes("--out-root"), true);
  assert.equal(commands[1].args.slice(separator + 1).includes("--target-outcome"), true);
  assert.deepEqual(commands[3].args.slice(-4), ["--tester-fee", "1", "--tester-fee-base", "1000"]);
  assert.match(output.text, /"type":"selected"/u);
  assert.match(output.text, /testerScenario":"all-ckb-limit-order"/u);
  assert.match(output.text, /testerScenario":"ickb-to-ckb-limit-order"/u);
});

test("dynamic supervisor loop stops after inspection-worthy supervisor-loop reasons", async () => {
  const commands = [];
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: [
      "--log-root", "log",
      "--session-root", "log/validation/inspection-session",
      "--max-chunks", "3",
      "--between-chunks-seconds", "0",
    ],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      appendFile: async () => undefined,
      spawnSync: (_command, args, options) => {
        commands.push({ args, options });
        if (args[0] === "scripts/ickb-live-preflight.mjs") {
          return { status: 0, signal: null, stdout: JSON.stringify({ balances: { CKB: { available: "3200" }, ICKB: { available: "0" } } }), stderr: "" };
        }
        return { status: 0, signal: null, stdout: "loop run=1 status=0 stopped=max_cycles outcomes=tester_order_created tx=1 new=tester_order_created stable=1 state=- decision=tx_observed out=log/validation/inspection-session/chunks/chunk-0001\nloop stopped reason=tx_observed runs=1 out=log/validation/inspection-session/chunks/chunk-0001\n", stderr: "" };
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(commands.length, 2);
  assert.match(output.text, /"supervisorLoopStopReason":"tx_observed"/u);
});

test("dynamic supervisor loop leaves supervisor target steering intact for auto tester choice", async () => {
  const commands = [];
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: [
      "--log-root", "log",
      "--session-root", "log/validation/auto-session",
      "--max-chunks", "1",
      "--",
      "--target-outcome", "tester_conversion_created",
    ],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      appendFile: async () => undefined,
      spawnSync: (_command, args, options) => {
        commands.push({ args, options });
        if (args[0] === "scripts/ickb-live-preflight.mjs") {
          return { status: 0, signal: null, stdout: JSON.stringify({ balances: { CKB: { available: "1000" }, ICKB: { available: "0" } } }), stderr: "" };
        }
        return { status: 0, signal: null, stdout: "loop run=1 status=0 stopped=max_cycles outcomes=- tx=0 new=- stable=1 state=- decision=max_runs out=logs/live-supervisor/test\n", stderr: "" };
      },
    },
  });

  const supervisorArgs = commands[1].args;
  const separator = supervisorArgs.indexOf("--");
  const passthrough = supervisorArgs.slice(separator + 1);
  assert.equal(exitCode, 0);
  assert.equal(passthrough.includes("--tester-scenario"), false);
  assert.equal(passthrough.includes("auto"), false);
  assert.equal(passthrough.includes("--target-outcome"), true);
  assert.match(output.text, /testerScenario":"auto"/u);
});

test("dynamic supervisor loop leaves fresh-order skip target planning to supervisor", async () => {
  const commands = [];
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: [
      "--log-root", "log",
      "--session-root", "log/validation/fresh-skip-session",
      "--max-chunks", "1",
      "--",
      "--target-outcome", "tester_fresh_order_skip",
    ],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      appendFile: async () => undefined,
      spawnSync: (_command, args, options) => {
        commands.push({ args, options });
        if (args[0] === "scripts/ickb-live-preflight.mjs") {
          return { status: 0, signal: null, stdout: JSON.stringify({ balances: { CKB: { available: "2100" }, ICKB: { available: "1" } } }), stderr: "" };
        }
        return { status: 0, signal: null, stdout: "loop run=1 status=0 stopped=max_cycles outcomes=tester_fresh_order_skip tx=0 new=- stable=1 state=- decision=max_runs out=logs/live-supervisor/test\n", stderr: "" };
      },
    },
  });

  const supervisorArgs = commands[1].args;
  const separator = supervisorArgs.indexOf("--");
  const passthrough = supervisorArgs.slice(separator + 1);
  assert.equal(exitCode, 0);
  assert.equal(passthrough.includes("--scenario"), false);
  assert.equal(passthrough.includes("--tester-scenario"), true);
  assert.equal(passthrough.includes("ickb-to-ckb-limit-order"), true);
  assert.equal(passthrough.includes("--tester-fee"), true);
  assert.equal(passthrough.includes("--target-outcome"), true);
});

test("dynamic supervisor loop stops on preflight failures", async () => {
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: ["--log-root", "log", "--session-root", "log/validation/preflight-failure", "--max-chunks", "1"],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      appendFile: async () => undefined,
      spawnSync: () => ({ status: 2, signal: null, stdout: "", stderr: "" }),
    },
  });

  assert.equal(exitCode, 2);
  assert.match(output.text, /preflight_failed/u);
});

test("dynamic supervisor loop reports preflight spawn errors", async () => {
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: ["--log-root", "log", "--session-root", "log/validation/preflight-spawn-error", "--max-chunks", "1"],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      appendFile: async () => undefined,
      spawnSync: () => ({ status: null, signal: null, stdout: "", stderr: "", error: new Error("spawn ETIMEDOUT") }),
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /preflight command failed: spawn ETIMEDOUT/u);
});

test("dynamic supervisor loop preserves supervisor chunk spawn errors", async () => {
  const appended = new Map();
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: ["--log-root", "log", "--session-root", "log/validation/chunk-spawn-error", "--max-chunks", "1"],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      appendFile: async (path, text) => appended.set(path, `${appended.get(path) ?? ""}${text}`),
      spawnSync: (_command, args) => {
        if (args[0] === "scripts/ickb-live-preflight.mjs") {
          return { status: 0, signal: null, stdout: JSON.stringify({ balances: { CKB: { available: "3200" }, ICKB: { available: "0" } } }), stderr: "" };
        }
        return { status: null, signal: null, stdout: "", stderr: "", error: new Error("spawn ETIMEDOUT") };
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /Supervisor chunk failed: spawn ETIMEDOUT/u);
  assert.match(appended.get("/repo/log/validation/chunk-spawn-error/operator/stderr.log"), /Supervisor chunk failed: spawn ETIMEDOUT/u);
});

test("dynamic supervisor loop preserves malformed preflight stderr", async () => {
  const appended = new Map();
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: ["--log-root", "log", "--session-root", "log/validation/preflight-stderr", "--max-chunks", "1"],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      appendFile: async (path, text) => appended.set(path, `${appended.get(path) ?? ""}${text}`),
      spawnSync: () => ({ status: 0, signal: null, stdout: "not json", stderr: "preflight diagnostic\n" }),
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /preflight diagnostic/u);
  assert.match(appended.get("/repo/log/validation/preflight-stderr/operator/stderr.log"), /preflight diagnostic/u);
});

function missingStat() {
  const error = new Error("missing");
  error.code = "ENOENT";
  throw error;
}
