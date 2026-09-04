import { ccc } from "@ckb-ccc/core";
import { getConfig, IckbSdk } from "@ickb/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  runTesterCli,
  runTesterEntrypoint,
  type TesterCliDependencies,
} from "../src/tester.ts";

const privateKey = `0x${"11".repeat(32)}` as const;
const testerScenario = "sdk-conversion";
type TesterRuntimeConfig = Awaited<
  ReturnType<TesterCliDependencies["readTesterRuntimeConfig"]>
>;

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

      await runTesterEntrypoint(["node", entrypoint.pathname], entrypoint.href, run);

      expect(run).toHaveBeenCalledWith([]);
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
    const runTesterTurn = vi.fn<TesterCliDependencies["runTesterTurn"]>(async () => {
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
        runTesterTurn,
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

    expect(runTesterTurn).toHaveBeenCalledTimes(1);
    expect(createPublicClient).toHaveBeenCalledWith("testnet", "http://127.0.0.1:8114");
    const testerTurnCall = runTesterTurn.mock.calls[0]?.[0];
    if (testerTurnCall === undefined) {
      throw new Error("expected tester loop call");
    }
    const expectedPrimaryLock = (
      await testerTurnCall.runtime.signer.getRecommendedAddressObj()
    ).script;
    expect(testerTurnCall.runtime.client).toBe(client);
    expect(testerTurnCall.runtime.signer).toBeInstanceOf(ccc.SignerCkbPrivateKey);
    expect(testerTurnCall.runtime.sdk).toBeInstanceOf(IckbSdk);
    expect(testerTurnCall.runtime.primaryLock).toEqual(expectedPrimaryLock);
    expect(testerTurnCall.runtime.accountLocks).toBe(accountLocks);
    expect(testerTurnCall.testerScenario).toBe(testerScenario);
    expect(testerTurnCall.feePolicy).toBe(feePolicy);
  });
});

describe("validation tester CLI arguments", () => {
  it("rejects any argument before runtime setup", async () => {
    await expect(runTesterCli(["--unknown"], {})).rejects.toThrow(
      "Unknown argument: --unknown",
    );
  });
});

function testerRuntimeConfig(): TesterRuntimeConfig {
  return {
    chain: "testnet",
    privateKey,
    rpcUrl: "http://127.0.0.1:8114",
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
