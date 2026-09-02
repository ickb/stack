import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runLiveBotStimulusTest } from "../../../../src/supervisor/stimulus/shared/liveBotStimulusTest.ts";
import {
  LIVE_BOT_STIMULUS_SUITE,
  TEST_SESSION,
  expectStimulusRunResult,
  launcherStartedRecord,
  liveBotStimulusDependencies,
  matchedCommitEventText,
  processIdentityFixture,
  testArgs,
  testBotIdentity,
  textWriter,
} from "../../support/stimulus/liveBotStimulus.ts";
import { MAX_EVENT_READ_BYTES } from "../../support/stimulus/liveBotStimulusRuntimeImports.ts";
import { waitForLiveBotQuiescence } from "../../support/stimulus/liveBotStimulusSessionImports.ts";

const { join } = path;
const BOT_EVENTS_NDJSON = "bot.events.ndjson";
const LAUNCHES_NDJSON = "launches.ndjson";
const TESTER_MUST_NOT_RUN = "tester must not run";

it.each([
  ["malformed", "not-json\n", "starts with malformed run evidence"],
  [
    "mismatched",
    `${JSON.stringify({ app: "bot", runId: "other-run" })}\n`,
    "belongs to another launcher runId",
  ],
] as const)("rejects %s rotated event evidence", async (_name, eventText, message) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-live-bot-rotation-"));
  const botEventsPath = join(tmpRoot, BOT_EVENTS_NDJSON);
  await writeFile(botEventsPath, eventText);

  await expect(
    waitForLiveBotQuiescence(
      botEventsPath,
      { offset: Number.MAX_SAFE_INTEGER },
      testArgs({ waitSeconds: 1, pollSeconds: 1 }),
      undefined,
      async () => {
        await Promise.resolve();
      },
      { now: () => 0 },
      "run-1",
    ),
  ).rejects.toThrow(message);
});

it("accepts same-run non-preflight evidence at the rotation boundary", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-live-bot-rotation-"));
  const botEventsPath = join(tmpRoot, BOT_EVENTS_NDJSON);
  const eventText = `${JSON.stringify({
    version: 1,
    app: "bot",
    chain: "testnet",
    runId: "run-1",
    iterationId: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "bot.iteration.started",
  })}\n`;
  await writeFile(botEventsPath, eventText);
  const times = [0, 0, 0, 1000, 1000];

  await expect(
    waitForLiveBotQuiescence(
      botEventsPath,
      { offset: Number.MAX_SAFE_INTEGER },
      testArgs({ waitSeconds: 1, pollSeconds: 1 }),
      undefined,
      async () => {
        await Promise.resolve();
      },
      { now: () => times.shift() ?? 1000 },
      "run-1",
    ),
  ).resolves.toMatchObject({
    status: "failed",
    reason: "timed out waiting for live bot matched-order commit",
    scan: { acceptedEventCount: 1 },
  });

  await writeFile(
    botEventsPath,
    `${JSON.stringify({ app: "bot", runId: "run-1", type: "bot.chain.preflight" })}\n`,
  );
  const preflightTimes = [0, 0, 0, 1000, 1000];
  await expect(
    waitForLiveBotQuiescence(
      botEventsPath,
      { offset: Number.MAX_SAFE_INTEGER },
      testArgs({ waitSeconds: 1, pollSeconds: 1 }),
      undefined,
      async () => {
        await Promise.resolve();
      },
      { now: () => preflightTimes.shift() ?? 1000 },
      "run-1",
    ),
  ).resolves.toMatchObject({
    status: "failed",
    scan: { acceptedEventCount: 0 },
  });
});

describe(LIVE_BOT_STIMULUS_SUITE, () => {
  it("runs tester stimulus then waits on the already-running live bot", async () => {
    const root = "/repo";
    const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-live-bot-stimulus-test-"));
    const args = testArgs({
      logRoot: tmpRoot,
      sessionRoot: join(tmpRoot, "validation", TEST_SESSION),
      waitSeconds: 1,
      pollSeconds: 1,
    });
    const writes = new Map<string, string>();
    const appended = new Map<string, string>();
    const reads = new Map<string, string>();
    const botEventsPath = join(tmpRoot, "bot", BOT_EVENTS_NDJSON);
    const launchesPath = join(tmpRoot, "bot", LAUNCHES_NDJSON);
    reads.set(launchesPath, `${JSON.stringify(launcherStartedRecord())}\n`);
    const previousEventText = `not-json\n${matchedCommitEventText("dd", "dd")}`;
    const reactionEventText = matchedCommitEventText("ee", "cc");
    let eventText = previousEventText;

    await mkdir(path.dirname(botEventsPath), { recursive: true });

    await writeFile(botEventsPath, eventText);
    const supervisorArgs: string[][] = [];
    const stdout = textWriter();

    const exitCode = await runLiveBotStimulusTest({
      root,
      args,
      io: { stdout, stderr: textWriter() },
      dependencies: liveBotStimulusDependencies({
        root,
        writes,
        appended,
        reads,
        setEventText: (text) => {
          eventText = text;

          writeFileSync(botEventsPath, eventText);
        },
        previousEventText,
        reactionEventText,
        supervisorArgs,
      }),
    });

    expect(exitCode).toBe(0);
    expectStimulusRunResult({
      tmpRoot,
      supervisorArgs,
      stdout,
      writes,
      appended,
    });
  });
});

it.each(["launcher-exit", "launcher-restart", "child-exit", "child-restart"] as const)(
  "does not run tester after %s at the final identity proof",
  async (failure) => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-live-bot-freshness-"));
    const botEventsPath = join(tmpRoot, "bot", BOT_EVENTS_NDJSON);
    const launchesPath = join(tmpRoot, "bot", LAUNCHES_NDJSON);
    const reads = new Map([
      [launchesPath, `${JSON.stringify(launcherStartedRecord())}\n`],
    ]);
    await mkdir(path.dirname(botEventsPath), { recursive: true });
    await writeFile(botEventsPath, "");
    const supervisorArgs: string[][] = [];
    let identityReads = 0;
    const dependencies = liveBotStimulusDependencies({
      root: "/repo",
      writes: new Map(),
      appended: new Map(),
      reads,
      setEventText: () => {
        throw new Error(TESTER_MUST_NOT_RUN);
      },
      previousEventText: "",
      reactionEventText: "",
      supervisorArgs,
      readProcessIdentity: async (pid) => {
        identityReads += 1;
        const failedPid = failure.startsWith("launcher") ? 100 : 101;
        if (identityReads > 2 && pid === failedPid) {
          if (failure.endsWith("exit")) {
            throw new Error("process exited during preflight");
          }
          return { bootId: "test-boot", startTimeTicks: "9999" };
        }
        return processIdentityFixture(pid);
      },
    });

    await expect(
      runLiveBotStimulusTest({
        root: "/repo",
        args: testArgs({
          logRoot: tmpRoot,
          sessionRoot: join(tmpRoot, "validation", TEST_SESSION),
        }),
        dependencies,
      }),
    ).rejects.toThrow(
      `${failure.startsWith("launcher") ? "launcher" : "child"} process ${
        failure.endsWith("exit") ? "is not running" : "start time does not match"
      }`,
    );
    expect(supervisorArgs).toEqual([]);
  },
);

it.each([
  [1, "found 1 existing matchable user order"],
  ["1", "matchableUserOrderCount is missing or malformed"],
  [-1, "matchableUserOrderCount is missing or malformed"],
] as const)(
  "refuses tester execution for tester matchable-order inventory %j",
  async (testerMatchableOrderCount, message) => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-live-bot-inventory-"));
    const botEventsPath = join(tmpRoot, "bot", BOT_EVENTS_NDJSON);
    const launchesPath = join(tmpRoot, "bot", LAUNCHES_NDJSON);
    const reads = new Map([
      [launchesPath, `${JSON.stringify(launcherStartedRecord())}\n`],
    ]);
    await mkdir(path.dirname(botEventsPath), { recursive: true });
    await writeFile(botEventsPath, "");
    const supervisorArgs: string[][] = [];
    const dependencies = liveBotStimulusDependencies({
      root: "/repo",
      writes: new Map(),
      appended: new Map(),
      reads,
      setEventText: () => {
        throw new Error(TESTER_MUST_NOT_RUN);
      },
      previousEventText: "",
      reactionEventText: "",
      supervisorArgs,
      testerMatchableOrderCount,
    });

    await expect(
      runLiveBotStimulusTest({
        root: "/repo",
        args: testArgs({
          logRoot: tmpRoot,
          sessionRoot: join(tmpRoot, "validation", TEST_SESSION),
        }),
        dependencies,
      }),
    ).rejects.toThrow(message);
    expect(supervisorArgs).toEqual([]);
  },
);

it.each([
  {
    name: "belongs to another run",
    options: { botRunId: "other-run" },
    message: "lacks canonical preflight identity for launcher runId",
  },
  {
    name: "uses another primary lock",
    options: {
      botIdentity: testBotIdentity({
        primaryLock: {
          codeHash: `0x${"33".repeat(32)}`,
          hashType: "type",
          args: `0x${"44".repeat(20)}`,
        },
      }),
    },
    message: "runtime identity does not match bot config preflight",
  },
  {
    name: "uses another exclusive RPC endpoint",
    options: {
      botIdentity: testBotIdentity({
        rpcEndpoint: {
          mode: "exclusive",
          protocol: "https:",
          hostname: "rpc.example",
          port: "",
          pathname: "/ckb",
        },
      }),
    },
    message: "runtime identity does not match bot config preflight",
  },
  {
    name: "is duplicated for one run",
    options: { botPreflightCopies: 2 },
    message: "duplicate canonical preflight identity events",
  },
  ...[
    { botPreflightEventFields: { version: 2 } },
    { botPreflightEventFields: { iterationId: 1 } },
    { botPreflightEventFields: { chain: "mainnet" } },
    {
      botPreflightEventFields: {
        matches: { genesisHash: false, addressPrefix: true },
      },
    },
    {
      botPreflightEventFields: {
        matches: { genesisHash: true, addressPrefix: false },
      },
    },
    { botPreflightEventFields: { timestamp: undefined } },
    { botPreflightEventFields: { identity: undefined } },
    { botIdentity: testBotIdentity({ unexpected: true }) },
    { botIdentity: testBotIdentity({ primaryLock: undefined }) },
    { botIdentity: testBotIdentity({ chain: undefined }) },
    { botIdentity: testBotIdentity({ chain: "" }) },
    { botIdentity: testBotIdentity({ bounded: "false" }) },
    { botIdentity: testBotIdentity({ sleepIntervalMs: -1 }) },
    { botIdentity: testBotIdentity({ sleepIntervalMs: undefined }) },
    { botIdentity: testBotIdentity({ rpcEndpoint: undefined }) },
    { botIdentity: testBotIdentity({ rpcEndpoint: { mode: "default", port: "" } }) },
    {
      botIdentity: testBotIdentity({
        rpcEndpoint: {
          mode: "exclusive",
          protocol: "wss:",
          hostname: "rpc.example",
          port: "",
          pathname: "/ws",
        },
      }),
    },
    { botIdentity: testBotIdentity({ bounded: true }) },
    { botIdentity: testBotIdentity({ maxIterations: 1 }) },
    { botIdentity: testBotIdentity({ maxRetryableAttempts: "2" }) },
    { botPreflightReportFields: { sleepIntervalSeconds: "1" } },
    { botPreflightReportFields: { sleepIntervalSeconds: -1 } },
    { botPreflightReportFields: { sleepIntervalSeconds: 0.0001 } },
  ].map((options, index) => ({
    name: `has malformed public envelope ${String(index + 1)}`,
    options,
    message: "live bot public identity is malformed",
  })),
])(
  "does not run tester when canonical bot identity $name",
  async ({ options, message }) => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-live-bot-identity-"));
    const botEventsPath = join(tmpRoot, "bot", BOT_EVENTS_NDJSON);
    const launchesPath = join(tmpRoot, "bot", LAUNCHES_NDJSON);
    await mkdir(path.dirname(botEventsPath), { recursive: true });
    await writeFile(botEventsPath, "");
    const supervisorArgs: string[][] = [];

    await expect(
      runLiveBotStimulusTest({
        root: "/repo",
        args: testArgs({
          logRoot: tmpRoot,
          sessionRoot: join(tmpRoot, "validation", TEST_SESSION),
        }),
        dependencies: liveBotStimulusDependencies({
          root: "/repo",
          writes: new Map(),
          appended: new Map(),
          reads: new Map([
            [launchesPath, `${JSON.stringify(launcherStartedRecord())}\n`],
          ]),
          setEventText: () => {
            throw new Error(TESTER_MUST_NOT_RUN);
          },
          previousEventText: "",
          reactionEventText: "",
          supervisorArgs,
          ...options,
        }),
      }),
    ).rejects.toThrow(message);
    expect(supervisorArgs).toEqual([]);
  },
);

it("proves bot identity from a bounded prefix of a large event history", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-live-bot-history-"));
  const botEventsPath = join(tmpRoot, "bot", BOT_EVENTS_NDJSON);
  const launchesPath = join(tmpRoot, "bot", LAUNCHES_NDJSON);
  await mkdir(path.dirname(botEventsPath), { recursive: true });
  const identityEvent = `${JSON.stringify({
    version: 1,
    app: "bot",
    chain: "testnet",
    runId: "run-1",
    iterationId: 0,
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "bot.chain.preflight",
    identity: testBotIdentity(),
    matches: { genesisHash: true, addressPrefix: true },
  })}\n`;
  const oversizedTail = "x".repeat(MAX_EVENT_READ_BYTES + 1);
  await writeFile(botEventsPath, `${identityEvent}${oversizedTail}`);
  await writeFile(
    launchesPath,
    `${oversizedTail}\n${JSON.stringify(launcherStartedRecord())}\n`,
  );
  await expect(
    runLiveBotStimulusTest({
      root: "/repo",
      args: testArgs({
        logRoot: tmpRoot,
        sessionRoot: join(tmpRoot, "validation", TEST_SESSION),
      }),
      dependencies: liveBotStimulusDependencies({
        root: "/repo",
        writes: new Map(),
        appended: new Map(),
        reads: new Map([
          [launchesPath, `${JSON.stringify(launcherStartedRecord())}\n`],
          [botEventsPath, `${identityEvent}${oversizedTail}`],
        ]),
        setEventText: () => {
          throw new Error(TESTER_MUST_NOT_RUN);
        },
        previousEventText: "",
        reactionEventText: "",
        supervisorArgs: [],
      }),
    }),
  ).rejects.toThrow(TESTER_MUST_NOT_RUN);
  const dependencies = {
    ...liveBotStimulusDependencies({
      root: "/repo",
      writes: new Map(),
      appended: new Map(),
      reads: new Map(),
      setEventText: () => {
        throw new Error(TESTER_MUST_NOT_RUN);
      },
      previousEventText: "",
      reactionEventText: "",
      supervisorArgs: [],
    }),
    readFile: undefined,
  };

  await expect(
    runLiveBotStimulusTest({
      root: "/repo",
      args: testArgs({
        logRoot: tmpRoot,
        sessionRoot: join(tmpRoot, "validation", TEST_SESSION),
      }),
      dependencies,
    }),
  ).rejects.toThrow(TESTER_MUST_NOT_RUN);
});
