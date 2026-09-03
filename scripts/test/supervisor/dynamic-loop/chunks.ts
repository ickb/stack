import assert from "node:assert/strict";
import test from "node:test";
import {
  type CommandInvocation,
  type SpawnResultFixture,
  ALL_CKB_LIMIT_ORDER,
  ALL_CKB_LIMIT_ORDER_CHOICE,
  AUTO_CHOICE,
  BETWEEN_CHUNKS_SECONDS_OPTION,
  CUSTOM_TESTER_CONFIG,
  ICKB_TO_CKB_LIMIT_ORDER_CHOICE,
  KEEP_GOING_OPTION,
  LIVE_CHECK_SOURCE_COMMAND,
  LIVE_SUPERVISOR_OUT,
  OUT_ROOT_OPTION,
  PREFLIGHT_SCRIPT,
  SPAWN_TIMEOUT_MESSAGE,
  SUPERVISOR_LOOP_SCRIPT,
  TARGET_OUTCOME_OPTION,
  TESTER_CONFIG_OPTION,
  at,
  chooseTesterScenario,
  dynamicDependencies,
  fixed8DecimalToUnits,
  hasScript,
  isPrebuildCommand,
  loggedDynamicSpawn,
  maxRunsSupervisorResult,
  missingStat,
  okResult,
  preflightResult,
  requireBigInt,
  required,
  runDynamicSupervisorLoop,
  scriptCount,
  testOutput,
  validationArgs,
} from "./support.ts";

void test("dynamic supervisor loop chooses fundable tester scenarios", () => {
  const ckb = 100000000n;
  assert.equal(fixed8DecimalToUnits("1.00000001"), ckb + 1n);
  assert.equal(fixed8DecimalToUnits("bad"), undefined);
  const nearLiveCkb = requireBigInt(fixed8DecimalToUnits("2102.81677146"));
  const liveAllCkbMinimum = requireBigInt(fixed8DecimalToUnits("2332.22000000"));
  assert.notEqual(nearLiveCkb, undefined);
  assert.notEqual(liveAllCkbMinimum, undefined);
  assert.deepEqual(
    chooseTesterScenario({ ckb: 2001n * ckb, ickb: 0n, feeRate: 0n }),
    ALL_CKB_LIMIT_ORDER_CHOICE,
  );
  assert.deepEqual(
    chooseTesterScenario({
      ckb: liveAllCkbMinimum,
      plainCkb: liveAllCkbMinimum,
      ickb: 0n,
      feeRate: 33222n,
    }),
    ALL_CKB_LIMIT_ORDER_CHOICE,
  );
  assert.deepEqual(
    chooseTesterScenario({
      ckb: liveAllCkbMinimum,
      plainCkb: liveAllCkbMinimum,
      ickb: 100n * ckb,
      feeRate: 33222n,
      rawOrderFeePolicy: { fee: 1n, feeBase: 1000000n },
    }),
    ICKB_TO_CKB_LIMIT_ORDER_CHOICE,
  );
  assert.deepEqual(
    chooseTesterScenario({
      ckb: nearLiveCkb,
      plainCkb: nearLiveCkb,
      ickb: 100n * ckb,
      feeRate: 33222n,
    }),
    ICKB_TO_CKB_LIMIT_ORDER_CHOICE,
  );
  assert.deepEqual(
    chooseTesterScenario({
      ckb: 4000n * ckb,
      plainCkb: nearLiveCkb,
      ickb: 100n * ckb,
      feeRate: 33222n,
    }),
    ICKB_TO_CKB_LIMIT_ORDER_CHOICE,
  );
  assert.deepEqual(
    chooseTesterScenario({
      ckb: 4000n * ckb,
      plainCkb: 1999n * ckb,
      ickb: 100n * ckb,
      feeRate: 33222n,
    }),
    AUTO_CHOICE,
  );
  assert.deepEqual(
    chooseTesterScenario({ ckb: 2100n * ckb, ickb: 100n * ckb, feeRate: 33222n }),
    ICKB_TO_CKB_LIMIT_ORDER_CHOICE,
  );
  assert.deepEqual(
    chooseTesterScenario({ ckb: 2100n * ckb, ickb: 1n, feeRate: 33222n }),
    AUTO_CHOICE,
  );
  assert.deepEqual(
    chooseTesterScenario({ ckb: 1999n * ckb, ickb: 1n, feeRate: 0n }),
    AUTO_CHOICE,
  );
});

void test("dynamic supervisor loop runs selected bounded chunks", async () => {
  const commands: CommandInvocation[] = [];
  const sleeps: number[] = [];
  const output = testOutput();
  const preflightResults = [
    preflightResult({ ckb: "3200", ickb: "0", feeRate: "0" }),
    preflightResult({ ckb: "2100", plainCkb: "2100", ickb: "100", feeRate: "0" }),
  ];
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: [
      TESTER_CONFIG_OPTION,
      CUSTOM_TESTER_CONFIG,
      ...validationArgs("test-session", "2", BETWEEN_CHUNKS_SECONDS_OPTION, "0"),
      "--",
      TARGET_OUTCOME_OPTION,
      "bot_match_committed",
    ],
    io: { stdout: output, stderr: output },
    dependencies: dynamicDependencies(
      loggedDynamicSpawn({
        commands,
        preflight: () => required(preflightResults.shift(), "Missing preflight result"),
        supervisor: maxRunsSupervisorResult({ out: LIVE_SUPERVISOR_OUT }),
      }),
      {
        sleep: (ms: number) => {
          sleeps.push(ms);
        },
      },
    ),
  });

  assert.equal(exitCode, 3);
  assert.equal(sleeps.length, 0);
  assert.equal(commands.length, 3);
  assert.deepEqual(
    commands.slice(0, 1).map((item) => item.args),
    [[LIVE_CHECK_SOURCE_COMMAND]],
  );
  assert.equal(at(commands, 2).args.includes(ALL_CKB_LIMIT_ORDER), true);
  assert.deepEqual(at(commands, 1).args.slice(1, 3), ["--config", CUSTOM_TESTER_CONFIG]);
  assert.deepEqual(at(commands, 2).args.slice(0, 3), [
    SUPERVISOR_LOOP_SCRIPT,
    OUT_ROOT_OPTION,
    "log/validation/test-session/chunks/chunk-0001",
  ]);
  const supervisorCommand = at(commands, 2);
  const separator = supervisorCommand.args.indexOf("--");
  assert.equal(
    supervisorCommand.args.slice(0, separator).includes(OUT_ROOT_OPTION),
    true,
  );
  assert.equal(
    supervisorCommand.args.slice(0, separator).includes("--skip-build"),
    false,
  );
  assert.deepEqual(supervisorCommand.args.slice(separator + 1, separator + 5), [
    "--scenario",
    "tester-only",
    TESTER_CONFIG_OPTION,
    CUSTOM_TESTER_CONFIG,
  ]);
  assert.equal(
    supervisorCommand.args.slice(separator + 1).includes(TARGET_OUTCOME_OPTION),
    true,
  );
  assert.match(output.text, /"type":"selected"/u);
  assert.match(output.text, /testerScenario":"all-ckb-limit-order"/u);
});

void test("dynamic supervisor loop keep-going continues after expected chunk stops", async () => {
  const commands: CommandInvocation[] = [];
  const sleeps: number[] = [];
  const output = testOutput();
  const supervisorOutputs: SpawnResultFixture[] = [
    {
      status: 0,
      stdout:
        "loop run=1 status=0 stopped=stop_after_tx_count outcomes=tester_order_created tx=1 new=tester_order_created stable=1 state=- decision=tx_observed out=log/validation/keep-going/chunks/chunk-0001\nloop stopped reason=tx_observed runs=1 out=log/validation/keep-going/chunks/chunk-0001\n",
    },
    {
      status: 0,
      stdout:
        "loop run=1 status=0 stopped=max_cycles outcomes=bot_no_action_skip tx=0 new=bot_no_action_skip stable=1 state=- decision=new_outcome out=log/validation/keep-going/chunks/chunk-0002\nloop stopped reason=new_outcome runs=1 out=log/validation/keep-going/chunks/chunk-0002\n",
    },
    {
      status: 3,
      stdout:
        "loop run=1 status=0 stopped=max_cycles outcomes=tester_fresh_order_skip tx=0 new=tester_fresh_order_skip stable=1 state=- decision=max_runs out=log/validation/keep-going/chunks/chunk-0003\nloop stopped reason=max_runs runs=1 out=log/validation/keep-going/chunks/chunk-0003\n",
    },
    {
      status: 3,
      stdout:
        "loop run=1 status=0 stopped=max_cycles outcomes=bot_no_action_skip tx=0 new=bot_no_action_skip stable=1 state=- decision=stable_no_progress out=log/validation/keep-going/chunks/chunk-0004\nloop stopped reason=stable_no_progress runs=1 out=log/validation/keep-going/chunks/chunk-0004\n",
    },
  ];
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs(
      "keep-going",
      "4",
      BETWEEN_CHUNKS_SECONDS_OPTION,
      "0",
      KEEP_GOING_OPTION,
    ),
    io: { stdout: output, stderr: output },
    dependencies: dynamicDependencies(
      loggedDynamicSpawn({
        commands,
        preflight: preflightResult({ ckb: "3200", ickb: "0", feeRate: "0" }),
        supervisor: () => ({
          signal: null,
          stderr: "",
          ...required(supervisorOutputs.shift(), "Missing supervisor output"),
        }),
      }),
      {
        sleep: (ms: number) => {
          sleeps.push(ms);
        },
      },
    ),
  });

  assert.equal(exitCode, 0);
  assert.equal(scriptCount(commands, PREFLIGHT_SCRIPT), 4);
  assert.equal(scriptCount(commands, SUPERVISOR_LOOP_SCRIPT), 4);
  assert.deepEqual(sleeps, []);
  assert.match(
    output.text,
    /"type":"continuing_after_chunk","chunkIndex":1,"reason":"tx_observed","status":0/u,
  );
  assert.match(
    output.text,
    /"type":"continuing_after_chunk","chunkIndex":2,"reason":"new_outcome","status":0/u,
  );
  assert.match(
    output.text,
    /"type":"continuing_after_chunk","chunkIndex":3,"reason":"max_runs","status":3/u,
  );
  assert.doesNotMatch(output.text, /"type":"continuing_after_chunk","chunkIndex":4/u);
});

void test("dynamic supervisor loop keep-going stops on repeated status one preflight", async () => {
  const commands: Array<readonly string[]> = [];
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs(
      "repeated-status-one",
      "3",
      BETWEEN_CHUNKS_SECONDS_OPTION,
      "0",
      KEEP_GOING_OPTION,
    ),
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: () => true,
      writeFile: () => true,
      appendFile: () => true,
      spawnSync: (_command: string, args: readonly string[]) => {
        commands.push(args);
        if (isPrebuildCommand(args)) {
          return okResult();
        }
        return {
          status: 1,
          signal: null,
          stdout: "",
          stderr: "fetch failed\n",
        };
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(scriptCount(commands, PREFLIGHT_SCRIPT), 2);
  assert.equal(hasScript(commands, SUPERVISOR_LOOP_SCRIPT), false);
  assert.match(
    output.text,
    /"type":"continuing_after_chunk","chunkIndex":1,"reason":"status_1_retry","status":1/u,
  );
  assert.match(output.text, /"type":"repeated_status_1","chunkIndex":2,"status":1/u);
});

void test("dynamic supervisor loop keep-going stops on synthetic preflight failures", async () => {
  for (const result of [
    {
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      error: new Error(SPAWN_TIMEOUT_MESSAGE),
    },
    {
      status: 0,
      signal: null,
      stdout: "not json",
      stderr: "preflight diagnostic\n",
    },
  ]) {
    const commands: Array<readonly string[]> = [];
    const output = testOutput();
    const exitCode = await runDynamicSupervisorLoop({
      root: "/repo",
      argv: [
        ...validationArgs(
          `synthetic-preflight-${String(commands.length)}-${String(result.status ?? "null")}`,
          "2",
          BETWEEN_CHUNKS_SECONDS_OPTION,
          "0",
          KEEP_GOING_OPTION,
        ),
      ],
      io: { stdout: output, stderr: output },
      dependencies: {
        checkIgnored: () => true,
        stat: missingStat,
        lstat: missingStat,
        mkdir: () => true,
        writeFile: () => true,
        appendFile: () => true,
        spawnSync: (_command: string, args: readonly string[]) => {
          commands.push(args);
          return isPrebuildCommand(args) ? okResult() : result;
        },
      },
    });

    assert.equal(exitCode, 1);
    assert.equal(scriptCount(commands, PREFLIGHT_SCRIPT), 1);
    assert.equal(hasScript(commands, SUPERVISOR_LOOP_SCRIPT), false);
    assert.doesNotMatch(output.text, /"type":"continuing_after_chunk"/u);
    assert.doesNotMatch(output.text, /"type":"repeated_status_1"/u);
  }
});
