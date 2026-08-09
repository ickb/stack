import { ccc } from "@ckb-ccc/core";
import { getConfig, IckbSdk } from "@ickb/sdk";
import { TESTER_OWNED_TX_HASH_FLAG } from "@ickb/validation";
import { describe, expect, it, vi } from "vitest";
import {
  actorEntrypoints as liveBotActorEntrypoints,
  runLiveBotStimulusCli,
  runLiveBotStimulusEntrypoint,
  type LiveBotStimulusMain,
  type RunSupervisorMain,
} from "../src/liveBotStimulusTest.ts";
import {
  runSupervisorCli,
  runSupervisorEntrypoint,
  actorEntrypoints as supervisorActorEntrypoints,
} from "../src/supervisor.ts";
import {
  parseOwnedTxHash,
  runTesterCli,
  runTesterEntrypoint,
  type TesterCliDependencies,
} from "../src/tester.ts";

const privateKey = `0x${"11".repeat(32)}` as const;
const testerScenario = "sdk-conversion";
const liveStimulusArgv = ["--log-root", "log"];
const ownedTxHash = `0x${"AB".repeat(32)}` as const;
type TesterRuntimeConfig = Awaited<
  ReturnType<TesterCliDependencies["readTesterRuntimeConfig"]>
>;

describe("validation supervisor CLI entrypoints", () => {
  it("runs the supervisor with source actor paths", async () => {
    const runMain = vi.fn(async (): Promise<number> => {
      await Promise.resolve();
      return 7;
    });

    await expect(runSupervisorCli(["--help"], runMain)).resolves.toBe(7);

    expect(supervisorActorEntrypoints).toEqual({
      bot: "apps/bot/src/index.ts",
      tester: "apps/validation/src/tester.ts",
    });
    expect(runMain).toHaveBeenCalledWith(["--help"], {
      actorEntrypoints: supervisorActorEntrypoints,
    });
  });

  it("sets process exit code for the supervisor entrypoint", async () => {
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const run = vi.fn(async (): Promise<number> => {
      await Promise.resolve();
      return 7;
    });
    try {
      process.argv = [
        originalArgv[0] ?? "node",
        new URL("../src/supervisor.ts", import.meta.url).pathname,
        "--help",
      ];
      process.exitCode = undefined;

      await runSupervisorEntrypoint(
        process.argv,
        new URL("../src/supervisor.ts", import.meta.url).href,
        run,
      );

      expect(run).toHaveBeenCalledWith(["--help"]);
      expect(process.exitCode).toBe(7);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });
});

describe("validation tester CLI entrypoints", () => {
  it("skips tester CLI body when the module is imported", async () => {
    const run = vi.fn(async (): Promise<void> => {
      await Promise.resolve();
    });

    await runTesterEntrypoint(
      ["node", new URL("../src/other.ts", import.meta.url).pathname],
      import.meta.url,
      run,
    );

    expect(run).not.toHaveBeenCalled();
  });

  it("runs tester CLI body when invoked as the entrypoint", async () => {
    const originalExitCode = process.exitCode;
    const run = vi.fn(async (): Promise<void> => {
      await Promise.resolve();
    });
    const entrypoint = new URL("../src/tester.ts", import.meta.url);
    try {
      process.exitCode = undefined;

      await runTesterEntrypoint(
        ["node", entrypoint.pathname, TESTER_OWNED_TX_HASH_FLAG, ownedTxHash],
        entrypoint.href,
        run,
      );

      expect(run).toHaveBeenCalledWith([TESTER_OWNED_TX_HASH_FLAG, ownedTxHash]);
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("preserves a tester failure exit code while returning naturally", async () => {
    const originalExitCode = process.exitCode;
    const run = vi.fn(async (): Promise<void> => {
      await Promise.resolve();
      process.exitCode = 2;
    });
    const entrypoint = new URL("../src/tester.ts", import.meta.url);
    try {
      process.exitCode = undefined;

      await expect(
        runTesterEntrypoint(["node", entrypoint.pathname], entrypoint.href, run),
      ).resolves.toBeUndefined();

      expect(process.exitCode).toBe(2);
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});

describe("validation tester CLI runtime", () => {
  it("wires tester runtime dependencies without running a process", async () => {
    const client = new ccc.ClientPublicTestnet({ url: "https://example.invalid" });
    const createPublicClient = vi.fn(
      (): ReturnType<TesterCliDependencies["createPublicClient"]> => client,
    );
    const config = getConfig("testnet");
    const accountLocks: ccc.Script[] = [];
    const feePolicy: ReturnType<TesterCliDependencies["readTesterFeePolicy"]> = {
      fee: 1n,
      feeBase: 1000n,
    };
    const runTesterLoop = vi.fn<TesterCliDependencies["runTesterLoop"]>(async () => {
      await Promise.resolve();
    });

    await runTesterCli(
      [],
      {
        TESTER_SCENARIO: testerScenario,
        TESTER_FEE: "1",
      },
      {
        createPublicClient,
        getConfig: vi.fn((): ReturnType<TesterCliDependencies["getConfig"]> => config),
        readTesterFeePolicy: vi.fn(
          (): ReturnType<TesterCliDependencies["readTesterFeePolicy"]> => feePolicy,
        ),
        readTesterRuntimeConfig: vi.fn(async (): Promise<TesterRuntimeConfig> => {
          await Promise.resolve();
          return testerRuntimeConfig();
        }),
        readTesterScenario: vi.fn(
          (): ReturnType<TesterCliDependencies["readTesterScenario"]> => testerScenario,
        ),
        runTesterLoop,
        signerAccountLocks: vi.fn(
          async (): ReturnType<TesterCliDependencies["signerAccountLocks"]> => {
            await Promise.resolve();
            return accountLocks;
          },
        ),
        verifyChainPreflight: vi.fn(
          async (): ReturnType<TesterCliDependencies["verifyChainPreflight"]> => {
            await Promise.resolve();
            return chainPreflightEvidence();
          },
        ),
      } satisfies Partial<TesterCliDependencies>,
    );

    expect(runTesterLoop).toHaveBeenCalledTimes(1);
    expect(createPublicClient).toHaveBeenCalledWith("testnet", "http://127.0.0.1:8114");
    expect(runTesterLoop.mock.calls[0]?.[0].ownedTxHash).toBeUndefined();
    const testerLoopCall = runTesterLoop.mock.calls[0]?.[0];
    if (testerLoopCall === undefined) {
      throw new Error("expected tester loop call");
    }
    const expectedPrimaryLock = (
      await testerLoopCall.runtime.signer.getRecommendedAddressObj()
    ).script;
    expect(testerLoopCall.runtime.client).toBe(client);
    expect(testerLoopCall.runtime.signer).toBeInstanceOf(ccc.SignerCkbPrivateKey);
    expect(testerLoopCall.runtime.sdk).toBeInstanceOf(IckbSdk);
    expect(testerLoopCall.runtime.primaryLock).toEqual(expectedPrimaryLock);
    expect(testerLoopCall.runtime.accountLocks).toBe(accountLocks);
    expect(testerLoopCall.testerScenario).toBe(testerScenario);
    expect(testerLoopCall.feePolicy).toBe(feePolicy);
    expect(testerLoopCall.sleepIntervalMs).toBe(4);
    expect(testerLoopCall.maxIterations).toBe(2);
    expect(testerLoopCall.maxRetryableAttempts).toBe(3);
  });
});

describe("validation tester CLI provenance", () => {
  it("accepts one supervisor correlation transaction hash", async () => {
    const client = new ccc.ClientPublicTestnet({ url: "https://example.invalid" });
    const runTesterLoop = vi.fn<TesterCliDependencies["runTesterLoop"]>(async () => {
      await Promise.resolve();
    });

    await runTesterCli(
      [TESTER_OWNED_TX_HASH_FLAG, ownedTxHash],
      { TESTER_SCENARIO: testerScenario },
      {
        createPublicClient: () => client,
        getConfig: () => getConfig("testnet"),
        readTesterFeePolicy: () => ({ fee: 1n, feeBase: 1000n }),
        readTesterRuntimeConfig: async () => {
          await Promise.resolve();
          return testerRuntimeConfig();
        },
        readTesterScenario: () => testerScenario,
        runTesterLoop,
        signerAccountLocks: async () => {
          await Promise.resolve();
          return [];
        },
        verifyChainPreflight: async () => {
          await Promise.resolve();
          return chainPreflightEvidence();
        },
      },
    );

    expect(runTesterLoop).toHaveBeenCalledTimes(1);
    expect(runTesterLoop.mock.calls[0]?.[0].ownedTxHash).toBe(ownedTxHash.toLowerCase());
    expect(parseOwnedTxHash([TESTER_OWNED_TX_HASH_FLAG, ownedTxHash])).toBe(
      ownedTxHash.toLowerCase(),
    );
  });

  it.each([
    [["--unknown"], "Unknown argument: --unknown"],
    [[TESTER_OWNED_TX_HASH_FLAG], `Missing value for ${TESTER_OWNED_TX_HASH_FLAG}`],
    [
      [TESTER_OWNED_TX_HASH_FLAG, TESTER_OWNED_TX_HASH_FLAG],
      `Missing value for ${TESTER_OWNED_TX_HASH_FLAG}`,
    ],
    [
      [TESTER_OWNED_TX_HASH_FLAG, "0x12"],
      `Invalid ${TESTER_OWNED_TX_HASH_FLAG}: expected a 0x-prefixed 64-digit transaction hash`,
    ],
    [
      [TESTER_OWNED_TX_HASH_FLAG, ownedTxHash, TESTER_OWNED_TX_HASH_FLAG, ownedTxHash],
      `Duplicate argument: ${TESTER_OWNED_TX_HASH_FLAG}`,
    ],
    [[TESTER_OWNED_TX_HASH_FLAG, ownedTxHash, "extra"], "Unknown argument: extra"],
  ])("rejects unowned tester arguments before runtime setup", (argv, message) => {
    expect(() => parseOwnedTxHash(argv)).toThrow(message);
  });
});

describe("validation live stimulus entrypoints", () => {
  it("wires live stimulus through the supervisor dependency", async () => {
    const runSupervisorMain: RunSupervisorMain = vi.fn(async (): Promise<number> => {
      await Promise.resolve();
      return 9;
    });
    const io = { stdout: writable(), stderr: writable() };
    const liveBotStimulusCalls: Array<Parameters<LiveBotStimulusMain>> = [];
    const liveBotStimulusMain: LiveBotStimulusMain = async (
      argv,
      dependencies,
    ): Promise<number> => {
      await Promise.resolve();
      liveBotStimulusCalls.push([argv, dependencies]);
      const result = await dependencies.runSupervisor(["--scenario", "auto"], io);
      return result + 1;
    };

    await expect(
      runLiveBotStimulusCli(liveStimulusArgv, {
        liveBotStimulusMain,
        runSupervisorMain,
      }),
    ).resolves.toBe(10);

    expect(liveBotActorEntrypoints).toEqual(supervisorActorEntrypoints);
    expect(liveBotStimulusCalls[0]?.[0]).toEqual(liveStimulusArgv);
    expect(typeof liveBotStimulusCalls[0]?.[1].runSupervisor).toBe("function");
    expect(runSupervisorMain).toHaveBeenCalledWith(
      ["--scenario", "auto"],
      { actorEntrypoints: liveBotActorEntrypoints },
      io,
    );
  });

  it("sets process exit code for the live stimulus entrypoint", async () => {
    const originalExitCode = process.exitCode;
    const run = vi.fn(async (): Promise<number> => {
      await Promise.resolve();
      return 8;
    });
    try {
      const entrypoint = new URL("../src/liveBotStimulusTest.ts", import.meta.url);
      process.exitCode = undefined;

      await runLiveBotStimulusEntrypoint(
        ["node", entrypoint.pathname, ...liveStimulusArgv],
        entrypoint.href,
        run,
      );

      expect(run).toHaveBeenCalledWith(liveStimulusArgv);
      expect(process.exitCode).toBe(8);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("skips live stimulus when imported without an entrypoint path", async () => {
    const run = vi.fn(async (): Promise<number> => {
      await Promise.resolve();
      return 8;
    });

    await runLiveBotStimulusEntrypoint(["node"], import.meta.url, run);

    expect(run).not.toHaveBeenCalled();
  });
});

function writable(): { write: (chunk: string) => boolean } {
  return {
    write: () => true,
  };
}

function testerRuntimeConfig(): TesterRuntimeConfig {
  return {
    chain: "testnet",
    maxIterations: 2,
    maxRetryableAttempts: 3,
    privateKey,
    rpcUrl: "http://127.0.0.1:8114",
    sleepIntervalMs: 4,
  };
}

function chainPreflightEvidence(): Awaited<
  ReturnType<TesterCliDependencies["verifyChainPreflight"]>
> {
  return {
    chain: "testnet",
    expected: {
      addressPrefix: "ckt",
      chain: "testnet",
      genesisHash: `0x${"aa".repeat(32)}`,
      genesisMessage: "aggron-v4",
      genesisSource: "test",
      networkName: "ckb_testnet",
    },
    observed: {
      addressPrefix: "ckt",
      genesisHash: `0x${"aa".repeat(32)}`,
      tip: { hash: `0x${"bb".repeat(32)}`, number: 1n, timestamp: 2n },
    },
    matches: { addressPrefix: true, genesisHash: true },
  };
}
