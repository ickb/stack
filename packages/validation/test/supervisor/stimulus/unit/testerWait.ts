import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import {
  botEvent,
  launcherStartedRecord,
  matchedOrderDecision,
  processIdentityFixture,
  TEST_LAUNCH_IDENTITY,
  testArgs,
  textWriter,
  txHash,
} from "../../support/stimulus/liveBotStimulus.ts";
import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  BOT_ITERATION_FAILED_EVENT,
  BOT_TRANSACTION_BUILT_EVENT,
  BOT_TRANSACTION_COMMITTED_EVENT,
  MAX_EVENT_READ_BYTES,
  TESTER_ORDER_CREATED,
} from "../../support/stimulus/liveBotStimulusRuntimeImports.ts";
import {
  eventFileCursor,
  runTesterStimulus,
  testerStimulusSucceeded,
  waitAfterTesterStimulus,
  waitForLiveBotQuiescence,
  waitSummary,
  type Dependencies,
  type LauncherProof,
  type StimulusChoice,
} from "../../support/stimulus/liveBotStimulusSessionImports.ts";
import {
  asyncNoop,
  asyncOpen,
  asyncSize,
  expectFailedWait,
  mapWrite,
  readableHandle,
  sessionPaths,
  stimulus,
} from "./support.ts";

const { join } = path;
const MISSING_SUMMARY_ERROR = "missing summary";
const NESTED_STDOUT = "nested stdout";
const NESTED_STDERR = "nested stderr";
const EVENTS_PATH = "/events.ndjson";
const TIMED_OUT_WAITING = "timed out waiting";
const UNKNOWN_OUTPOINT = "unknown outpoint";
const NO_ACTIONS = "no_actions";
const BOT_DECISION_SKIPPED = "bot.decision.skipped";
const EXACTLY_ONE_ORDER_FAILURE =
  "tester stimulus did not create exactly one non-dust order transaction";

it("builds an event cursor when file identity is unavailable", async () => {
  await expect(
    eventFileCursor(EVENTS_PATH, {
      stat: async () => {
        await Promise.resolve();
        return { size: 3 };
      },
      open: asyncOpen("raw"),
    }),
  ).resolves.toEqual({ offset: 3 });
});

it("records the last complete event line in the stimulus cursor", async () => {
  const previous = `${JSON.stringify(botEvent("bot.cursor.baseline", {}))}\n`;
  await expect(
    eventFileCursor(EVENTS_PATH, {
      stat: asyncSize(Buffer.byteLength(previous)),
      open: asyncOpen(previous),
    }),
  ).resolves.toEqual({
    offset: Buffer.byteLength(previous),
    lastEventLine: previous.trimEnd(),
  });
});

it("reports tester stimulus summary failure modes", () => {
  expect(testerStimulusSucceeded(stimulus())).toEqual({
    ok: true,
    txHash: txHash("fa"),
  });
  expect(
    testerStimulusSucceeded({
      status: 1,
      outDir: "out",
      summaryPath: "s",
      stdout: "",
      stderr: "",
    }),
  ).toEqual({
    ok: false,
    reason: "tester stimulus supervisor exited with status 1",
  });
  expect(
    testerStimulusSucceeded({
      status: 0,
      outDir: "out",
      summaryPath: "s",
      stdout: "",
      stderr: "",
    }),
  ).toEqual({
    ok: false,
    reason: "tester stimulus summary.json missing",
  });
  expect(
    testerStimulusSucceeded({
      status: 0,
      outDir: "out",
      summaryPath: "s",
      stdout: "",
      stderr: "",
      summary: { artifacts: [null, "cycle-0001-incident.json"] },
    }),
  ).toEqual({ ok: false, reason: "tester stimulus wrote an incident artifact" });
  expect(
    testerStimulusSucceeded({
      status: 0,
      outDir: "out",
      summaryPath: "s",
      stdout: "",
      stderr: "",
      summary: { aggregateCounts: {} },
    }),
  ).toEqual({
    ok: false,
    reason: EXACTLY_ONE_ORDER_FAILURE,
  });
});

it("rejects missing or non-single tester order evidence", () => {
  const summaries = [
    {
      artifacts: [],
      aggregateCounts: { [TESTER_ORDER_CREATED]: 1 },
    },
    {
      artifacts: [],
      aggregateCounts: { [TESTER_ORDER_CREATED]: 1 },
      testerOrderEvidence: [
        {
          outcome: TESTER_ORDER_CREATED,
          orderCount: 2,
          orders: [{ dust: false }, { dust: false }],
        },
      ],
    },
  ];

  for (const summary of summaries) {
    expect(testerStimulusSucceeded(stimulus({ summary }))).toEqual({
      ok: false,
      reason: EXACTLY_ONE_ORDER_FAILURE,
    });
  }
});

it("captures a failed tester stimulus run", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-stimulus-tester-run-"));
  const paths = sessionPaths(tmpRoot);
  const writes = new Map<string, string>();
  const result = await runTesterStimulus(
    tmpRoot,
    testArgs({ testerFee: undefined, testerFeeBase: undefined }),
    paths,
    { scenario: ALL_CKB_LIMIT_ORDER_SCENARIO, reason: "test" },
    {
      pid: 100,
      childPid: 101,
      runId: "run-1",
      identity: TEST_LAUNCH_IDENTITY,
    },
    {
      runSupervisor: async (_argv, io): Promise<number> => {
        io.stdout.write(NESTED_STDOUT);
        io.stderr.write(NESTED_STDERR);
        await Promise.resolve();
        return 1;
      },
      writeFile: mapWrite(writes),
      readFile: async (filePath) => {
        await Promise.resolve();
        if (filePath === paths.launchesPath) {
          return `${JSON.stringify(launcherStartedRecord())}\n`;
        }
        throw new Error(MISSING_SUMMARY_ERROR);
      },
      readProcessIdentity: processIdentityFixture,
    },
  );

  expect(result.status).toBe(1);
  expect(result.stdout).toBe(NESTED_STDOUT);
  expect(result.stderr).toBe(NESTED_STDERR);
  expect(result.summary).toBeUndefined();
  expect(writes.get(join(paths.sessionRoot, "supervisor/stdout.log"))).toBe(
    NESTED_STDOUT,
  );
});

it("preserves nested tester output when supervisor execution throws", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-stimulus-tester-throw-"));
  const paths = sessionPaths(tmpRoot);
  const writes = new Map<string, string>();

  await expect(
    runTesterStimulus(
      tmpRoot,
      testArgs(),
      paths,
      { scenario: ALL_CKB_LIMIT_ORDER_SCENARIO, reason: "test" },
      {
        pid: 100,
        childPid: 101,
        runId: "run-1",
        identity: TEST_LAUNCH_IDENTITY,
      },
      {
        runSupervisor: async (_argv, io): Promise<never> => {
          io.stdout.write(NESTED_STDOUT);
          io.stderr.write(NESTED_STDERR);
          await Promise.resolve();
          throw new Error("supervisor crashed");
        },
        writeFile: mapWrite(writes),
        readFile: async (): Promise<string> => {
          await Promise.resolve();
          return `${JSON.stringify(launcherStartedRecord())}\n`;
        },
        readProcessIdentity: processIdentityFixture,
      },
    ),
  ).rejects.toThrow("supervisor crashed");
  expect(writes.get(join(paths.sessionRoot, "supervisor/stdout.log"))).toBe(
    NESTED_STDOUT,
  );
  expect(writes.get(join(paths.sessionRoot, "supervisor/stderr.log"))).toBe(
    NESTED_STDERR,
  );
});

it("waits for live bot failure, timeout, and file-boundary outcomes", async () => {
  const failureEvent = `${JSON.stringify(
    botEvent(BOT_ITERATION_FAILED_EVENT, { terminal: true, retryable: false }),
  )}\n`;
  await expect(
    waitForLiveBotQuiescence(
      EVENTS_PATH,
      { offset: 0 },
      testArgs({ waitSeconds: 1 }),
      undefined,
      asyncNoop,
      {
        now: () => 0,
        stat: asyncSize(failureEvent.length),
        open: asyncOpen(failureEvent),
      },
    ),
  ).resolves.toMatchObject({ status: "failed" });

  await expect(
    waitForLiveBotQuiescence(
      EVENTS_PATH,
      { offset: 10 },
      testArgs({ waitSeconds: 1 }),
      undefined,
      asyncNoop,
      {
        now: steppedClock([0, 0, 0, 1000]),
        stat: asyncSize(9),
        open: asyncOpen(""),
      },
    ),
  ).rejects.toThrow("lacks a complete run identity line");
  await expect(
    waitForLiveBotQuiescence(
      EVENTS_PATH,
      { offset: 0 },
      testArgs(),
      undefined,
      asyncNoop,
      {
        stat: asyncSize(MAX_EVENT_READ_BYTES + 1),
      },
    ),
  ).rejects.toThrow("delta exceeded");
  const timeoutResult = await waitForLiveBotQuiescence(
    EVENTS_PATH,
    { offset: 0 },
    testArgs({ waitSeconds: 1 }),
    undefined,
    asyncNoop,
    {
      now: steppedClock([0, 0, 0, 1000]),
      stat: asyncSize(0),
    },
    "run-1",
  );
  const failedTimeoutResult = expectFailedWait(timeoutResult);
  expect(failedTimeoutResult.reason).toContain(TIMED_OUT_WAITING);
});

it("rejects malformed live bot event evidence", async () => {
  const malformedEvents = `${[
    botEvent("bot.future", {}),
    botEvent("bot.state.read", { type: undefined }),
    botEvent(BOT_TRANSACTION_COMMITTED_EVENT, { txHash: undefined }),
  ]
    .map((event) => JSON.stringify(event))
    .join("\n")}\n`;

  await expect(
    waitForLiveBotQuiescence(
      EVENTS_PATH,
      { offset: 0 },
      testArgs(),
      undefined,
      asyncNoop,
      {
        now: () => 0,
        stat: asyncSize(malformedEvents.length),
        open: asyncOpen(malformedEvents),
      },
    ),
  ).resolves.toMatchObject({
    status: "failed",
    reason: "live bot emitted malformed event evidence after tester stimulus",
    scan: { malformedLineCount: 3 },
  });
});

it("times out when a matched commit is not followed by quiescence", async () => {
  const matchOnlyEvents = `${JSON.stringify(
    botEvent(BOT_TRANSACTION_BUILT_EVENT, {
      actions: { matchedOrders: 1 },
      ...matchedOrderDecision("dd"),
    }),
  )}\n${JSON.stringify(
    botEvent(BOT_TRANSACTION_COMMITTED_EVENT, { txHash: txHash("cc") }),
  )}\n`;

  await expect(
    waitForLiveBotQuiescence(
      EVENTS_PATH,
      { offset: 0 },
      testArgs({ waitSeconds: 1 }),
      txHash("dd"),
      asyncNoop,
      {
        now: steppedClock([0, 0, 0, 1000, 1000]),
        stat: asyncSize(matchOnlyEvents.length),
        open: asyncOpen(matchOnlyEvents),
      },
    ),
  ).resolves.toMatchObject({
    status: "failed",
    reason: "timed out waiting for live bot quiescence after matched-order commit",
  });
});

it("bounds polling sleep to the explicit deadline", async () => {
  let clock = 0;
  const sleeps: number[] = [];
  const result = await waitForLiveBotQuiescence(
    EVENTS_PATH,
    { offset: 0 },
    testArgs({ waitSeconds: 2, pollSeconds: 5 }),
    undefined,
    asyncNoop,
    {
      now: () => clock,
      stat: asyncSize(0),
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
        await Promise.resolve();
      },
    },
  );

  expect(result).toMatchObject({ status: "failed", elapsedMs: 2000 });
  expect(sleeps).toEqual([2000]);
});

it("checks the deadline again after launcher proof", async () => {
  let clock = 0;
  let statCalled = false;
  const result = await waitForLiveBotQuiescence(
    EVENTS_PATH,
    { offset: 0 },
    testArgs({ waitSeconds: 1 }),
    undefined,
    async () => {
      clock = 1000;
      await Promise.resolve();
    },
    {
      now: () => clock,
      stat: async () => {
        statCalled = true;
        await Promise.resolve();
        return { size: 0 };
      },
    },
  );

  expect(result).toMatchObject({ status: "failed", elapsedMs: 1000 });
  expect(statCalled).toBe(false);
});

it("stops a live bot wait when interrupted", async () => {
  await expect(
    waitForLiveBotQuiescence(
      EVENTS_PATH,
      { offset: 0 },
      testArgs(),
      undefined,
      asyncNoop,
      { receivedSignal: () => "SIGINT" },
    ),
  ).rejects.toThrow("Process interrupted by SIGINT");
});

it("reads short event ranges without skipping bytes", async () => {
  const event = `${JSON.stringify(
    botEvent(BOT_ITERATION_FAILED_EVENT, { terminal: true, retryable: false }),
  )}\n`;
  const result = await waitForLiveBotQuiescence(
    EVENTS_PATH,
    { offset: 0 },
    testArgs({ waitSeconds: 1 }),
    undefined,
    asyncNoop,
    {
      now: () => 0,
      stat: asyncSize(Buffer.byteLength(event)),
      open: asyncOpen(event, 2),
    },
  );

  expect(result).toMatchObject({
    status: "failed",
    scan: { acceptedEventCount: 1, offset: Buffer.byteLength(event) },
  });
});

it("preserves UTF-8 characters split across appends", async () => {
  const event = `${JSON.stringify(
    botEvent(BOT_ITERATION_FAILED_EVENT, {
      terminal: true,
      retryable: false,
      reason: "cafe\u{301}",
    }),
  )}\n`;
  const bytes = Buffer.from(event);
  const split = bytes.indexOf(Buffer.from("\u{301}")) + 1;
  let size = split;
  const result = await waitForLiveBotQuiescence(
    EVENTS_PATH,
    { offset: 0 },
    testArgs({ pollSeconds: 1 }),
    undefined,
    asyncNoop,
    {
      now: () => 0,
      stat: async () => {
        await Promise.resolve();
        return { size };
      },
      open: asyncOpen(event),
      sleep: async () => {
        size = bytes.length;
        await Promise.resolve();
      },
    },
  );

  expect(result).toMatchObject({
    status: "failed",
    scan: { acceptedEventCount: 1, latestFailure: { reason: "cafe\u{301}" } },
  });
});

it("resets only cursor state after same-run event log rotation", async () => {
  const event = `${JSON.stringify(
    botEvent(BOT_ITERATION_FAILED_EVENT, { terminal: true, retryable: false }),
  )}\n`;
  const result = await waitForLiveBotQuiescence(
    EVENTS_PATH,
    { offset: 100, fileIdentity: "1:1" },
    testArgs({ waitSeconds: 1 }),
    undefined,
    asyncNoop,
    {
      now: () => 0,
      stat: async () => {
        await Promise.resolve();
        return { size: Buffer.byteLength(event), dev: 1, ino: 2 };
      },
      open: asyncOpen(event),
    },
    "run-1",
  );

  expect(result).toMatchObject({
    status: "failed",
    scan: { offset: Buffer.byteLength(event), fileIdentity: "1:2" },
  });
});

it("preserves matched-order state across same-run event rotation", async () => {
  const committed = `${JSON.stringify(
    botEvent(BOT_TRANSACTION_COMMITTED_EVENT, { txHash: txHash("cc") }),
  )}\n`;
  const beforeRotation = `${JSON.stringify(
    botEvent(BOT_TRANSACTION_BUILT_EVENT, {
      actions: { matchedOrders: 1 },
      ...matchedOrderDecision("dd"),
    }),
  )}\n${committed}`;
  const afterRotation = `${committed}${JSON.stringify(
    botEvent(BOT_DECISION_SKIPPED, {
      iterationId: 8,
      reason: NO_ACTIONS,
      decision: { orders: { marketCount: 0, receiptCount: 0 } },
    }),
  )}\n`;
  let rotated = false;
  const result = await waitForLiveBotQuiescence(
    EVENTS_PATH,
    { offset: 0, fileIdentity: "1:1" },
    testArgs({ pollSeconds: 1 }),
    txHash("dd"),
    asyncNoop,
    {
      now: () => 0,
      stat: async () => {
        await Promise.resolve();
        return {
          size: Buffer.byteLength(rotated ? afterRotation : beforeRotation),
          dev: 1,
          ino: rotated ? 2 : 1,
        };
      },
      open: async () => {
        await Promise.resolve();
        return readableHandle(rotated ? afterRotation : beforeRotation);
      },
      sleep: async () => {
        rotated = true;
        await Promise.resolve();
      },
    },
    "run-1",
  );

  expect(result).toMatchObject({
    status: "quiescent",
    evidence: { txHash: txHash("cc") },
    quiescence: { skipped: { iterationId: 8 }, postMatchCommitCount: 0 },
    scan: { fileIdentity: "1:2" },
  });
});

it("does not replay retained pre-stimulus failure after rotation", async () => {
  const failure = `${JSON.stringify(
    botEvent(BOT_ITERATION_FAILED_EVENT, { terminal: true, retryable: false }),
  )}\n`;
  const result = await waitForLiveBotQuiescence(
    EVENTS_PATH,
    {
      offset: Buffer.byteLength(failure),
      fileIdentity: "1:1",
      lastEventLine: failure.trimEnd(),
    },
    testArgs({ waitSeconds: 0 }),
    undefined,
    asyncNoop,
    {
      now: () => 0,
      stat: async () => {
        await Promise.resolve();
        return { size: Buffer.byteLength(failure), dev: 1, ino: 2 };
      },
      open: asyncOpen(failure),
    },
    "run-1",
  );

  expect(result).toMatchObject({
    status: "failed",
    reason: "timed out waiting for live bot matched-order commit",
    scan: { acceptedEventCount: 0 },
  });
});

it("stops on retryable matched-order failure evidence", async () => {
  const retryableFailureText = `${JSON.stringify(
    botEvent(BOT_TRANSACTION_BUILT_EVENT, {
      actions: { matchedOrders: 1 },
      ...matchedOrderDecision("dd"),
    }),
  )}\n${JSON.stringify(
    botEvent(BOT_ITERATION_FAILED_EVENT, {
      retryable: true,
      terminal: false,
      error: { message: UNKNOWN_OUTPOINT },
    }),
  )}\n`;
  const retryableFailureTimeout = await waitForLiveBotQuiescence(
    EVENTS_PATH,
    { offset: 0 },
    testArgs({ waitSeconds: 1 }),
    txHash("dd"),
    asyncNoop,
    {
      now: () => 0,
      stat: asyncSize(retryableFailureText.length),
      open: asyncOpen(retryableFailureText),
    },
  );
  expect(waitSummary(retryableFailureTimeout)).toMatchObject({
    status: "failed",
    scan: {
      latestFailure: {
        type: BOT_ITERATION_FAILED_EVENT,
        retryable: true,
        terminal: false,
      },
      latestMatchedOrderFailure: {
        failure: {
          type: BOT_ITERATION_FAILED_EVENT,
          retryable: true,
          terminal: false,
          error: { message: UNKNOWN_OUTPOINT },
        },
      },
    },
  });
});

it("waits through maintenance commits until a later idle decision", async () => {
  let eventText = `${JSON.stringify(
    botEvent(BOT_TRANSACTION_BUILT_EVENT, {
      actions: { matchedOrders: 1 },
      ...matchedOrderDecision("dd"),
    }),
  )}\n${JSON.stringify(
    botEvent(BOT_TRANSACTION_COMMITTED_EVENT, { txHash: txHash("cc") }),
  )}\n`;
  let clock = 0;
  let sleeps = 0;
  const result = await waitForLiveBotQuiescence(
    EVENTS_PATH,
    { offset: 0 },
    testArgs({ waitSeconds: 3, pollSeconds: 1 }),
    txHash("dd"),
    asyncNoop,
    {
      now: () => clock,
      stat: async () => {
        await Promise.resolve();
        return { size: Buffer.byteLength(eventText) };
      },
      open: async () => {
        await Promise.resolve();
        return readableHandle(eventText);
      },
      sleep: async (ms) => {
        sleeps += 1;
        clock += ms;
        eventText +=
          sleeps === 1
            ? `${JSON.stringify(
                botEvent(BOT_TRANSACTION_BUILT_EVENT, {
                  iterationId: 8,
                  actions: { matchedOrders: 0 },
                }),
              )}\n${JSON.stringify(
                botEvent(BOT_TRANSACTION_COMMITTED_EVENT, {
                  iterationId: 8,
                  txHash: txHash("ee"),
                }),
              )}\n`
            : `${JSON.stringify(
                botEvent(BOT_DECISION_SKIPPED, {
                  iterationId: 9,
                  reason: NO_ACTIONS,
                  decision: { orders: { marketCount: 0, receiptCount: 0 } },
                }),
              )}\n`;
        await Promise.resolve();
      },
    },
  );

  expect(result).toMatchObject({
    status: "quiescent",
    quiescence: {
      skipped: { iterationId: 9 },
      postMatchCommitCount: 1,
      latestCommit: { iterationId: 8, txHash: txHash("ee") },
    },
  });
  expect(sleeps).toBe(2);
});

it("invalidates idle when a newer bot iteration starts", async () => {
  let eventText = [
    botEvent(BOT_TRANSACTION_BUILT_EVENT, {
      actions: { matchedOrders: 1 },
      ...matchedOrderDecision("dd"),
    }),
    botEvent(BOT_TRANSACTION_COMMITTED_EVENT, { txHash: txHash("cc") }),
    botEvent(BOT_DECISION_SKIPPED, {
      iterationId: 8,
      reason: NO_ACTIONS,
      decision: { orders: { marketCount: 0, receiptCount: 0 } },
    }),
    botEvent("bot.iteration.started", { iterationId: 9 }),
    botEvent("bot.state.read", { iterationId: 9 }),
    botEvent("bot.match.evaluated", { iterationId: 9 }),
    botEvent("bot.rebalance.evaluated", { iterationId: 9 }),
    botEvent(BOT_DECISION_SKIPPED, {
      runId: "other-run",
      iterationId: 9,
      reason: NO_ACTIONS,
      decision: { orders: { marketCount: 0, receiptCount: 0 } },
    }),
  ]
    .map((event) => JSON.stringify(event))
    .join("\n");
  eventText += "\n";
  let clock = 0;
  let sleeps = 0;

  const result = await waitForLiveBotQuiescence(
    EVENTS_PATH,
    { offset: 0 },
    testArgs({ waitSeconds: 2, pollSeconds: 1 }),
    txHash("dd"),
    asyncNoop,
    {
      now: () => clock,
      stat: async () => {
        await Promise.resolve();
        return { size: Buffer.byteLength(eventText) };
      },
      open: async () => {
        await Promise.resolve();
        return readableHandle(eventText);
      },
      sleep: async (ms) => {
        sleeps += 1;
        clock += ms;
        eventText += `${JSON.stringify(
          botEvent(BOT_DECISION_SKIPPED, {
            iterationId: 9,
            reason: NO_ACTIONS,
            decision: { orders: { marketCount: 0, receiptCount: 0 } },
          }),
        )}\n`;
        await Promise.resolve();
      },
    },
  );

  expect(result).toMatchObject({
    status: "quiescent",
    quiescence: { skipped: { iterationId: 9 } },
    scan: {
      latestEvent: { type: BOT_DECISION_SKIPPED, iterationId: 9 },
      quiescenceSkip: { iterationId: 9 },
    },
  });
  expect(sleeps).toBe(1);
});

it("re-proves launcher identity before accepting quiescence", async () => {
  const text = `${JSON.stringify(
    botEvent(BOT_TRANSACTION_BUILT_EVENT, {
      actions: { matchedOrders: 1 },
      ...matchedOrderDecision("dd"),
    }),
  )}\n${JSON.stringify(
    botEvent(BOT_TRANSACTION_COMMITTED_EVENT, { txHash: txHash("cc") }),
  )}\n${JSON.stringify(
    botEvent(BOT_DECISION_SKIPPED, {
      iterationId: 8,
      reason: NO_ACTIONS,
      decision: { orders: { marketCount: 0, receiptCount: 0 } },
    }),
  )}\n`;
  let proofs = 0;

  await expect(
    waitForLiveBotQuiescence(
      EVENTS_PATH,
      { offset: 0 },
      testArgs(),
      txHash("dd"),
      async () => {
        proofs += 1;
        await Promise.resolve();
        if (proofs === 2) {
          throw new Error("live bot launcher identity changed since initial proof");
        }
      },
      {
        stat: asyncSize(Buffer.byteLength(text)),
        open: asyncOpen(text),
      },
    ),
  ).rejects.toThrow("launcher identity changed");
});

it("waits for live bot matched-order commits after polling", async () => {
  let statSize = 0;
  const sleeps: number[] = [];
  const matchText = `${JSON.stringify(
    botEvent(BOT_TRANSACTION_BUILT_EVENT, {
      actions: { matchedOrders: 1 },
      ...matchedOrderDecision("44"),
    }),
  )}\n${JSON.stringify(
    botEvent(BOT_TRANSACTION_COMMITTED_EVENT, { txHash: txHash("44") }),
  )}\n${JSON.stringify(
    botEvent(BOT_DECISION_SKIPPED, {
      iterationId: 8,
      reason: NO_ACTIONS,
      decision: { orders: { marketCount: 0, receiptCount: 0 } },
    }),
  )}\n`;
  const matched = await waitForLiveBotQuiescence(
    EVENTS_PATH,
    { offset: 0 },
    testArgs({ waitSeconds: 2, pollSeconds: 1 }),
    undefined,
    asyncNoop,
    {
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
        statSize = matchText.length;
        await Promise.resolve();
      },
      stat: async () => {
        await Promise.resolve();
        return { size: statSize };
      },
      open: asyncOpen(matchText),
    },
  );
  expect(matched.status).toBe("quiescent");
  expect(sleeps).toEqual([1000]);
  expect(waitSummary(matched)).toMatchObject({ status: "quiescent" });
});

it("writes wait-after-stimulus summaries for failed stimulus and failed waits", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-stimulus-wait-after-"));
  const paths = sessionPaths(tmpRoot);
  const stdout = textWriter();
  const writes = new Map<string, string>();
  const dependencies = waitAfterDependencies(writes);
  const launcher: LauncherProof = {
    pid: TEST_LAUNCH_IDENTITY.launcher.pid,
    childPid: TEST_LAUNCH_IDENTITY.child.pid,
    runId: "run-1",
    identity: TEST_LAUNCH_IDENTITY,
  };
  const choice: StimulusChoice = {
    scenario: ALL_CKB_LIMIT_ORDER_SCENARIO,
    reason: "test",
  };

  await expect(
    waitAfterTesterStimulus(
      paths,
      tmpRoot,
      testArgs(),
      launcher,
      choice,
      { offset: 0 },
      stimulus({ status: 1 }),
      dependencies,
      stdout,
    ),
  ).resolves.toBe(2);
  expect(stdout.text).toContain("exited with status 1");
  expect(writes.get(paths.summaryPath)).toContain("exited with status 1");

  stdout.text = "";
  await expect(
    waitAfterTesterStimulus(
      paths,
      tmpRoot,
      testArgs({ waitSeconds: 0 }),
      launcher,
      choice,
      { offset: 0 },
      stimulus({
        summary: {
          artifacts: [],
          aggregateCounts: { [TESTER_ORDER_CREATED]: 1 },
          testerOrderEvidence: [
            {
              outcome: TESTER_ORDER_CREATED,
              txHashes: [],
              orderCount: 1,
              orders: [{ dust: false }],
            },
          ],
        },
      }),
      dependencies,
      stdout,
    ),
  ).resolves.toBe(2);
  expect(stdout.text).toContain(EXACTLY_ONE_ORDER_FAILURE);
  expect(writes.get(paths.summaryPath)).toContain(EXACTLY_ONE_ORDER_FAILURE);

  stdout.text = "";
  await expect(
    waitAfterTesterStimulus(
      paths,
      tmpRoot,
      testArgs({ waitSeconds: 0 }),
      launcher,
      choice,
      { offset: 0 },
      stimulus(),
      dependencies,
      stdout,
    ),
  ).resolves.toBe(2);
  expect(stdout.text).toContain(TIMED_OUT_WAITING);
  expect(writes.get(paths.summaryPath)).toContain(TIMED_OUT_WAITING);
});

function waitAfterDependencies(writes: Map<string, string>): Dependencies {
  return {
    now: () => 0,
    writeFile: mapWrite(writes),
    appendFile: asyncNoop,
    stat: asyncSize(0),
    readFile: async (): Promise<string> => {
      await Promise.resolve();
      return `${JSON.stringify(launcherStartedRecord())}\n`;
    },
    readProcessIdentity: processIdentityFixture,
  };
}

function steppedClock(values: number[]): () => number {
  return () => values.shift() ?? values.at(-1) ?? 0;
}
