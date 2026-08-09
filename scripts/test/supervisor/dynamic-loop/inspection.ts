import assert from "node:assert/strict";
import test from "node:test";
import {
  type CommandInvocation,
  BETWEEN_CHUNKS_SECONDS_OPTION,
  ICKB_TO_CKB_LIMIT_ORDER,
  LIVE_SUPERVISOR_OUT,
  PREFLIGHT_SCRIPT,
  SCENARIO_OPTION,
  SPAWN_TIMEOUT_MESSAGE,
  SUPERVISOR_LOOP_SCRIPT,
  TARGET_OUTCOME_OPTION,
  TESTER_FEE_BASE_OPTION,
  TESTER_FEE_OPTION,
  TESTER_SCENARIO_OPTION,
  VALIDATION_ROOT,
  appendRecorder,
  argsByScript,
  commandByScript,
  dynamicDependencies,
  isPrebuildCommand,
  loggedDynamicSpawn,
  maxRunsSupervisorResult,
  missingStat,
  okResult,
  preflightResult,
  required,
  runDynamicSupervisorLoop,
  scriptCount,
  testOutput,
  validationArgs,
} from "./support.ts";

void test("dynamic supervisor loop stops after inspection-worthy supervisor-loop reasons", async () => {
  const commands: CommandInvocation[] = [];
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs("inspection-session", "3", BETWEEN_CHUNKS_SECONDS_OPTION, "0"),
    io: { stdout: output, stderr: output },
    dependencies: dynamicDependencies(
      loggedDynamicSpawn({
        commands,
        preflight: preflightResult({ ckb: "3200", ickb: "0", feeRate: "0" }),
        supervisor: {
          status: 0,
          signal: null,
          stdout:
            "loop run=1 status=0 stopped=max_cycles outcomes=tester_order_created tx=1 new=tester_order_created stable=1 state=- decision=tx_observed out=log/validation/inspection-session/chunks/chunk-0001\nloop stopped reason=tx_observed runs=1 out=log/validation/inspection-session/chunks/chunk-0001\n",
          stderr: "",
        },
      }),
    ),
  });

  assert.equal(exitCode, 0);
  assert.equal(commands.filter((command) => isPrebuildCommand(command.args)).length, 1);
  assert.equal(scriptCount(commands, PREFLIGHT_SCRIPT), 1);
  assert.equal(scriptCount(commands, SUPERVISOR_LOOP_SCRIPT), 1);
  assert.match(output.text, /"supervisorLoopStopReason":"tx_observed"/u);
});

void test("dynamic supervisor loop preserves supervisor-loop inspection-required status", async () => {
  const commands: CommandInvocation[] = [];
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs(
      "inspection-status-session",
      "3",
      BETWEEN_CHUNKS_SECONDS_OPTION,
      "0",
    ),
    io: { stdout: output, stderr: output },
    dependencies: dynamicDependencies(
      loggedDynamicSpawn({
        commands,
        preflight: preflightResult({ ckb: "3200", ickb: "0", feeRate: "0" }),
        supervisor: {
          status: 3,
          signal: null,
          stdout:
            "loop run=1 status=0 stopped=max_cycles outcomes=- tx=0 new=- stable=1 state=- decision=max_runs out=log/validation/inspection-status-session/chunks/chunk-0001\nloop stopped reason=max_runs runs=1 out=log/validation/inspection-status-session/chunks/chunk-0001\n",
          stderr: "",
        },
      }),
    ),
  });

  assert.equal(exitCode, 3);
  assert.equal(commands.filter((command) => isPrebuildCommand(command.args)).length, 1);
  assert.equal(scriptCount(commands, PREFLIGHT_SCRIPT), 1);
  assert.equal(scriptCount(commands, SUPERVISOR_LOOP_SCRIPT), 1);
  assert.match(output.text, /"supervisorLoopStopReason":"max_runs"/u);
});

void test("dynamic supervisor loop leaves supervisor target steering intact for auto tester choice", async () => {
  const commands: CommandInvocation[] = [];
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs(
      "auto-session",
      "1",
      "--",
      TARGET_OUTCOME_OPTION,
      "tester_conversion_created",
    ),
    io: { stdout: output, stderr: output },
    dependencies: dynamicDependencies(
      loggedDynamicSpawn({
        commands,
        preflight: preflightResult({ ckb: "1000", ickb: "0", feeRate: "0" }),
        supervisor: maxRunsSupervisorResult({ out: LIVE_SUPERVISOR_OUT }),
      }),
    ),
  });

  const supervisorArgs = commandByScript(commands, SUPERVISOR_LOOP_SCRIPT).args;
  const separator = supervisorArgs.indexOf("--");
  const passthrough = supervisorArgs.slice(separator + 1);
  assert.equal(exitCode, 3);
  assert.equal(passthrough.includes(TESTER_SCENARIO_OPTION), false);
  assert.equal(passthrough.includes("auto"), false);
  assert.equal(passthrough.includes(TARGET_OUTCOME_OPTION), true);
  assert.match(output.text, /testerScenario":"auto"/u);
});

void test("dynamic supervisor loop leaves fresh-order skip target planning to supervisor", async () => {
  const commands: CommandInvocation[] = [];
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs(
      "fresh-skip-session",
      "1",
      "--",
      TARGET_OUTCOME_OPTION,
      "tester_fresh_order_skip",
    ),
    io: { stdout: output, stderr: output },
    dependencies: dynamicDependencies(
      loggedDynamicSpawn({
        commands,
        preflight: preflightResult({
          ckb: "2100",
          plainCkb: "2100",
          ickb: "100",
          feeRate: "33222",
        }),
        supervisor: maxRunsSupervisorResult({
          outcome: "tester_fresh_order_skip",
          out: LIVE_SUPERVISOR_OUT,
        }),
      }),
    ),
  });

  const supervisorArgs = commandByScript(commands, SUPERVISOR_LOOP_SCRIPT).args;
  const separator = supervisorArgs.indexOf("--");
  const passthrough = supervisorArgs.slice(separator + 1);
  assert.equal(exitCode, 3);
  assert.equal(passthrough.includes(SCENARIO_OPTION), false);
  assert.equal(passthrough.includes(TESTER_SCENARIO_OPTION), true);
  assert.equal(passthrough.includes(ICKB_TO_CKB_LIMIT_ORDER), true);
  assert.equal(passthrough.includes(TESTER_FEE_OPTION), true);
  assert.equal(passthrough.includes(TARGET_OUTCOME_OPTION), true);
});

void test("dynamic supervisor loop lets explicit tester fee options override selected defaults", async () => {
  const commands: Array<readonly string[]> = [];
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs(
      "fee-override-session",
      "1",
      "--",
      TESTER_FEE_OPTION,
      "2",
      TESTER_FEE_BASE_OPTION,
      "2000",
    ),
    io: { stdout: output, stderr: output },
    dependencies: dynamicDependencies(
      loggedDynamicSpawn({
        argsLog: commands,
        preflight: preflightResult({
          ckb: "2100",
          plainCkb: "2100",
          ickb: "100",
          feeRate: "0",
        }),
        supervisor: maxRunsSupervisorResult({ out: LIVE_SUPERVISOR_OUT }),
      }),
    ),
  });

  const supervisorArgs = argsByScript(commands, SUPERVISOR_LOOP_SCRIPT);
  const separator = supervisorArgs.indexOf("--");
  const passthrough = supervisorArgs.slice(separator + 1);
  assert.equal(exitCode, 3);
  assert.equal(passthrough[passthrough.lastIndexOf(TESTER_FEE_OPTION) + 1], "2");
  assert.equal(passthrough[passthrough.lastIndexOf(TESTER_FEE_BASE_OPTION) + 1], "2000");
});

void test("dynamic supervisor loop stops on preflight failures", async () => {
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs("preflight-failure"),
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: () => true,
      writeFile: () => true,
      appendFile: () => true,
      spawnSync: (_command: string, args: readonly string[]) =>
        isPrebuildCommand(args)
          ? okResult()
          : { status: 2, signal: null, stdout: "", stderr: "" },
    },
  });

  assert.equal(exitCode, 2);
  assert.match(output.text, /preflight_failed/u);
});

void test("dynamic supervisor loop reports preflight spawn errors", async () => {
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs("preflight-spawn-error"),
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: () => true,
      writeFile: () => true,
      appendFile: () => true,
      spawnSync: (_command: string, args: readonly string[]) =>
        isPrebuildCommand(args)
          ? okResult()
          : {
              status: null,
              signal: null,
              stdout: "",
              stderr: "",
              error: new Error(SPAWN_TIMEOUT_MESSAGE),
            },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /preflight command failed: spawn ETIMEDOUT/u);
});

void test("dynamic supervisor loop preserves supervisor chunk spawn errors", async () => {
  const { appended, appendFile } = appendRecorder();
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs("chunk-spawn-error"),
    io: { stdout: output, stderr: output },
    dependencies: dynamicDependencies(
      loggedDynamicSpawn({
        preflight: preflightResult({ ckb: "3200", ickb: "0", feeRate: "0" }),
        supervisor: {
          status: null,
          signal: null,
          stdout: "",
          stderr: "",
          error: new Error(SPAWN_TIMEOUT_MESSAGE),
        },
      }),
      { appendFile },
    ),
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /Supervisor chunk failed: spawn ETIMEDOUT/u);
  assert.match(
    required(
      appended.get(`${VALIDATION_ROOT}/chunk-spawn-error/supervisor/stderr.log`),
      "Missing supervisor stderr log",
    ),
    /Supervisor chunk failed: spawn ETIMEDOUT/u,
  );
});

void test("dynamic supervisor loop preserves malformed preflight stderr", async () => {
  const { appended, appendFile } = appendRecorder();
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs("preflight-stderr"),
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: () => true,
      writeFile: () => true,
      appendFile,
      spawnSync: (_command: string, args: readonly string[]) =>
        isPrebuildCommand(args)
          ? okResult()
          : {
              status: 0,
              signal: null,
              stdout: "not json",
              stderr: "preflight diagnostic\n",
            },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /preflight diagnostic/u);
  assert.match(
    required(
      appended.get(`${VALIDATION_ROOT}/preflight-stderr/supervisor/stderr.log`),
      "Missing supervisor stderr log",
    ),
    /preflight diagnostic/u,
  );
});
