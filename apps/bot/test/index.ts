import { ccc } from "@ckb-ccc/core";
import { BotEventEmitter, type BotTurnContext } from "@ickb/bot";
import {
  publicRpcEndpointIdentity,
  type ChainPreflightEvidence,
  type RuntimeConfig,
} from "@ickb/node-utils";
import { getConfig, IckbSdk } from "@ickb/sdk";
import { StubClient } from "@ickb/testkit";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeBot,
  runBotCli,
  runBotEntrypoint,
  type BotCliDependencies,
} from "../src/index.ts";

const privateKey = `0x${"11".repeat(32)}` as const;
const TESTNET_RPC_URL = "https://testnet.example";
const testnetGenesisHash = `0x${"aa".repeat(32)}` as const;
const originalExitCode = process.exitCode;
const botEntrypoint = new URL("../src/index.ts", import.meta.url);
const testnetPreflightExpected = {
  addressPrefix: "ckt",
  chain: "testnet",
  genesisHash: testnetGenesisHash,
  genesisMessage: "aggron-v4",
  genesisSource: "test",
  networkName: "ckb_testnet",
} as const satisfies ChainPreflightEvidence["expected"];

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("bot CLI runtime wiring", () => {
  it("initializes runtime wiring from config and emits startup events", async () => {
    const events: Array<Record<string, unknown>> = [];
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

    expect(context.runtime.client).toBe(client);
    expect(context.runtime.managers).toBe(config.managers);
    expect(context.runtime.accountLocks).toHaveLength(1);
    expect(context.runtime).not.toHaveProperty("chain");
    expect(context.runtime).not.toHaveProperty("signer");
    const tx = ccc.Transaction.default();
    const completeTransaction = vi
      .spyOn(context.runtime.sdk, "completeTransaction")
      .mockResolvedValue(tx);
    const assertSent = wireSendSpies(client, tx);

    await expect(context.runtime.completeTransaction(tx, 42n)).resolves.toBe(tx);
    await expect(context.runtime.sendTransaction(tx)).resolves.toBe(testnetGenesisHash);

    const signer = completeTransaction.mock.calls[0]?.[1].signer;
    expect(completeTransaction).toHaveBeenCalledTimes(1);
    expect(completeTransaction).toHaveBeenCalledWith(tx, {
      signer,
      feeRate: 42n,
    });
    expect(signer).toBeInstanceOf(ccc.SignerCkbPrivateKey);
    assertSent();
    expect(events).toMatchObject([
      { type: "bot.run.started", runId: "run-1" },
      { type: "bot.chain.preflight", runId: "run-1", chain: "testnet" },
    ]);
    const preflight = eventAt(events, 1);
    expect(preflight).toMatchObject({
      expected: testnetPreflightExpected,
      matches: { addressPrefix: true, genesisHash: true },
      observed: {
        addressPrefix: "ckt",
        genesisHash: testnetGenesisHash,
        tip: {
          hash: `0x${"bb".repeat(32)}`,
          number: "1",
          timestamp: "2",
        },
      },
    });
    expect(preflight["identity"]).toEqual({
      chain: "testnet",
      primaryLock: {
        codeHash: context.runtime.primaryLock.codeHash,
        hashType: context.runtime.primaryLock.hashType,
        args: context.runtime.primaryLock.args,
      },
      rpcEndpoint: {
        mode: "exclusive",
        protocol: "https:",
        hostname: "testnet.example",
        port: "",
        pathname: "/",
      },
    });
    expect(preflight).not.toHaveProperty("rpcConfigured");
  });
});

function wireSendSpies(client: StubClient, tx: ccc.Transaction): () => void {
  vi.spyOn(tx, "hash").mockReturnValue(testnetGenesisHash);
  const sign = vi
    .spyOn(ccc.SignerCkbPrivateKey.prototype, "signTransaction")
    .mockResolvedValue(tx);
  const send = vi
    .spyOn(client, "sendTransactionNoCache")
    .mockResolvedValue(testnetGenesisHash);
  vi.spyOn(client.cache, "markTransactions").mockResolvedValue(undefined);
  return (): void => {
    expect(sign).toHaveBeenCalledWith(tx);
    expect(send).toHaveBeenCalledWith(tx);
  };
}

describe("bot CLI public identity", () => {
  it("uses the explicit RPC URL and publishes only chain, lock, and endpoint identity", async () => {
    const events: Array<Record<string, unknown>> = [];
    const dependencies = botDependencies({ events });
    const createPublicClient = vi.fn(dependencies.createPublicClient);
    dependencies.createPublicClient = createPublicClient;

    await initializeBot({}, dependencies);

    expect(createPublicClient).toHaveBeenCalledWith("testnet", TESTNET_RPC_URL);
    const identity = eventAt(events, 1)["identity"];
    const primaryLock = (
      await new ccc.SignerCkbPrivateKey(
        new StubClient(),
        privateKey,
      ).getRecommendedAddressObj()
    ).script;
    expect(identity).toEqual({
      chain: "testnet",
      primaryLock: {
        codeHash: primaryLock.codeHash,
        hashType: primaryLock.hashType,
        args: primaryLock.args,
      },
      rpcEndpoint: publicRpcEndpointIdentity(TESTNET_RPC_URL),
    });
  });

  it("uses a valid launcher run ID without calling the direct-run fallback", async () => {
    const events: Array<Record<string, unknown>> = [];
    const dependencies = botDependencies({ events });
    const createRunId = vi.fn(() => "fallback-run");
    const parentRunId = "parent:2026.01";
    dependencies.createRunId = createRunId;

    await initializeBot({ BOT_RUN_ID: parentRunId }, dependencies);

    expect(createRunId).not.toHaveBeenCalled();
    expect(events).toMatchObject([{ runId: parentRunId }, { runId: parentRunId }]);
  });

  it("falls back to a locally created run ID for direct runs", async () => {
    const events: Array<Record<string, unknown>> = [];
    const dependencies = botDependencies({ events });
    const directRunId = "direct-run";
    const createRunId = vi.fn(() => directRunId);
    dependencies.createRunId = createRunId;

    await initializeBot({}, dependencies);

    expect(createRunId).toHaveBeenCalledTimes(1);
    expect(events).toMatchObject([{ runId: directRunId }, { runId: directRunId }]);
  });

  it.each(["", "bad run", "bad/run", "x".repeat(129)])(
    "rejects malformed inherited run ID %j",
    async (runId) => {
      const dependencies = botDependencies();
      const createEvents = vi.fn(dependencies.createEvents);
      dependencies.createEvents = createEvents;

      await expect(initializeBot({ BOT_RUN_ID: runId }, dependencies)).rejects.toThrow(
        "Invalid env BOT_RUN_ID",
      );

      expect(createEvents).not.toHaveBeenCalled();
    },
  );
});

describe("bot CLI runtime boundaries", () => {
  it("keeps signing and RPC canaries out of public events", async () => {
    const events: Array<Record<string, unknown>> = [];
    const canaryPrivateKey = `0x${"42".repeat(32)}` as const;
    const canaryRpcUrl = "https://testnet.example/rpc?token=canary";

    await initializeBot(
      { BOT_RUN_ID: "canary-boundary" },
      botDependencies({
        events,
        runtimeConfig: { privateKey: canaryPrivateKey, rpcUrl: canaryRpcUrl },
      }),
    );

    const output = JSON.stringify(events);
    expect(output).not.toContain(canaryPrivateKey);
    expect(output).not.toContain(canaryRpcUrl);
    expect(output).not.toContain("token=canary");
  });

  it("runs the loop with the initialized context", async () => {
    const runBotTurn = vi.fn(async (): Promise<void> => {
      await Promise.resolve();
    });
    const dependencies = botDependencies({ runBotTurn });

    await runBotCli({}, dependencies);

    expect(runBotTurn).toHaveBeenCalledTimes(1);
  });

  it("uses the default event and SDK factories", async () => {
    const config = getConfig("testnet");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const dependencies: Partial<BotCliDependencies> = botDependencies({
      config,
      runBotTurn: async (context): Promise<void> => {
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

describe("bot CLI entrypoint execution", () => {
  it("skips the CLI body when the module is imported", async () => {
    const run = vi.fn(async (): Promise<void> => {
      await Promise.resolve();
    });

    await runBotEntrypoint(
      ["node", new URL("../src/other.ts", import.meta.url).pathname],
      import.meta.url,
      run,
    );

    expect(run).not.toHaveBeenCalled();
  });

  it("runs the CLI body and returns naturally when invoked as the entrypoint", async () => {
    const run = vi.fn(async (): Promise<void> => {
      await Promise.resolve();
    });
    await runBotEntrypoint(["node", botEntrypoint.pathname], botEntrypoint.href, run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it("preserves a loop-assigned exit status while returning naturally", async () => {
    const run = vi.fn(async (): Promise<void> => {
      await Promise.resolve();
      process.exitCode = 2;
    });
    await runBotEntrypoint(["node", botEntrypoint.pathname], botEntrypoint.href, run);

    expect(process.exitCode).toBe(2);
  });

  it("drains pipe-pressure NDJSON before naturally exiting with status 2", () => {
    const eventCount = 6000;
    const childScript = String.raw`
      const { runBotEntrypoint } = await import(${JSON.stringify(botEntrypoint.href)});
      const entrypoint = "/bot-pipe-pressure.ts";
      await runBotEntrypoint(["node", entrypoint], "file:///bot-pipe-pressure.ts", async () => {
        for (let index = 0; index < ${String(eventCount)}; index += 1) {
          process.stdout.write(JSON.stringify({ version: 1, app: "bot", type: "bot.test.pipe", index, payload: "x".repeat(256) }) + "\n");
        }
        process.exitCode = 2;
      });
    `;

    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", childScript],
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout.length).toBeGreaterThan(1024 * 1024);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(eventCount);
    for (const line of lines) {
      expect((): void => {
        JSON.parse(line);
      }).not.toThrow();
    }
  });
});

function botDependencies({
  client = new StubClient(),
  config = getConfig("testnet"),
  events = [],
  runtimeConfig = {},
  runBotTurn = vi.fn(async (): Promise<void> => {
    await Promise.resolve();
  }),
}: {
  client?: ccc.Client;
  config?: ReturnType<typeof getConfig>;
  events?: Array<Record<string, unknown>>;
  runtimeConfig?: Partial<RuntimeConfig>;
  runBotTurn?: (context: BotTurnContext) => Promise<void>;
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
        privateKey,
        rpcUrl: TESTNET_RPC_URL,
        ...runtimeConfig,
      };
    },
    runBotTurn,
    verifyChainPreflight: async (): Promise<ChainPreflightEvidence> => {
      await Promise.resolve();
      return chainPreflightEvidence();
    },
  };
}

function eventAt(
  events: Array<Record<string, unknown>>,
  index: number,
): Record<string, unknown> {
  const event = events[index];
  if (event === undefined) {
    throw new Error(`Missing bot event at index ${String(index)}`);
  }
  return event;
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
