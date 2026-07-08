import type { ccc } from "@ckb-ccc/core";
import { BotEventEmitter, type BotLoopContext } from "@ickb/bot";
import type { ChainPreflightEvidence } from "@ickb/node-utils";
import { getConfig, IckbSdk } from "@ickb/sdk";
import { StubClient } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeBot,
  runBotCli,
  type BotCliDependencies,
} from "../src/index.ts";

const privateKey = `0x${"11".repeat(32)}` as const;
const testnetGenesisHash = `0x${"aa".repeat(32)}` as const;
const testnetPreflightExpected = {
  addressPrefix: "ckt",
  chain: "testnet",
  genesisHash: testnetGenesisHash,
  genesisMessage: "aggron-v4",
  genesisSource: "test",
  networkName: "ckb_testnet",
} as const satisfies ChainPreflightEvidence["expected"];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bot CLI runtime wiring", () => {
  it("initializes runtime wiring from config and emits startup events", async () => {
    const events: unknown[] = [];
    const client = new StubClient();
    const config = getConfig("testnet");
    const dependencies = botDependencies({ client, config, events });

    const context = await initializeBot(
      {
        BOT_ARTIFACT_REF_PREFIX: "artifacts/slot-00",
        BOT_ARTIFACT_ROOT: "log/bot/artifacts/slot-00",
      },
      dependencies,
    );

    expect(context.sleepIntervalMs).toBe(60_000);
    expect(context.maxIterations).toBe(1);
    expect(context.maxRetryableAttempts).toBe(2);
    expect(context.runtime.client).toBe(client);
    expect(context.runtime.managers).toBe(config.managers);
    expect(events).toMatchObject([
      { type: "bot.run.started", runId: "run-1", bounded: true },
      { type: "bot.chain.preflight", runId: "run-1", rpcConfigured: true },
    ]);
  });

  it("runs the loop with the initialized context", async () => {
    const runBotLoop = vi.fn(async (): Promise<void> => {
      await Promise.resolve();
    });
    const dependencies = botDependencies({ runBotLoop });

    await runBotCli({}, dependencies);

    expect(runBotLoop).toHaveBeenCalledTimes(1);
  });

  it("uses the default event and SDK factories", async () => {
    const config = getConfig("testnet");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const dependencies: Partial<BotCliDependencies> = botDependencies({
      config,
      runBotLoop: async (context): Promise<void> => {
        expect(context.events).toBeInstanceOf(BotEventEmitter);
        expect(context.runtime.sdk).toBeInstanceOf(IckbSdk);
        expect(context.runtime.managers).toBe(config.managers);
        await Promise.resolve();
      },
    });
    delete dependencies.createEvents;
    delete dependencies.createSdk;

    await runBotCli({}, dependencies);

    expect(write).toHaveBeenCalledWith(
      expect.stringContaining('"type":"bot.run.started"'),
    );
  });
});

function botDependencies({
  client = new StubClient(),
  config = getConfig("testnet"),
  events = [],
  runBotLoop = vi.fn(async (): Promise<void> => {
    await Promise.resolve();
  }),
}: {
  client?: ccc.Client;
  config?: ReturnType<typeof getConfig>;
  events?: unknown[];
  runBotLoop?: (context: BotLoopContext) => Promise<void>;
} = {}): BotCliDependencies {
  return {
    createEvents: (context) =>
      new BotEventEmitter({
        ...context,
        write: (event): void => {
          events.push(event);
        },
      }),
    createPublicClient: () => client,
    createRunId: () => "run-1",
    createSdk: (sdkConfig) => IckbSdk.fromConfig(sdkConfig),
    getConfig: () => config,
    readBotRuntimeConfig: async (): ReturnType<
      BotCliDependencies["readBotRuntimeConfig"]
    > => {
      await Promise.resolve();
      return {
        chain: "testnet",
        maxIterations: 1,
        maxRetryableAttempts: 2,
        privateKey,
        rpcUrl: "https://testnet.example",
        sleepIntervalMs: 60_000,
      };
    },
    runBotLoop,
    verifyChainPreflight: async (): Promise<ChainPreflightEvidence> => {
      await Promise.resolve();
      return chainPreflightEvidence();
    },
  };
}

function chainPreflightEvidence(): ChainPreflightEvidence {
  return {
    chain: testnetPreflightExpected.chain,
    expected: testnetPreflightExpected,
    matches: { addressPrefix: true, genesisHash: true },
    observed: {
      addressPrefix: testnetPreflightExpected.addressPrefix,
      genesisHash: testnetGenesisHash,
      tip: { hash: `0x${"bb".repeat(32)}`, number: 1n, timestamp: 2n },
    },
  };
}
