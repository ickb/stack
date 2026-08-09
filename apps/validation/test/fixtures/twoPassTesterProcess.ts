import { ccc } from "@ckb-ccc/core";
import { getConfig, IckbSdk } from "@ickb/sdk";
import { pathToFileURL } from "node:url";
import {
  runTesterCli,
  runTesterEntrypoint,
  type TesterCliDependencies,
} from "../../src/tester.ts";

const emittedTxHash = ccc.hexFrom(`0x${"AB".repeat(32)}`);
const ownedTxHash = ccc.hexFrom(emittedTxHash.toLowerCase());

const dependencies: Partial<TesterCliDependencies> = {
  createPublicClient: () =>
    new ccc.ClientPublicTestnet({ url: "https://example.invalid" }),
  getConfig: () => getConfig("testnet"),
  readTesterFeePolicy: () => ({ fee: 1n, feeBase: 1000n }),
  readTesterRuntimeConfig: async () => {
    await Promise.resolve();
    return {
      chain: "testnet",
      maxIterations: 1,
      maxRetryableAttempts: 1,
      privateKey: ccc.hexFrom(`0x${"11".repeat(32)}`),
      rpcUrl: "https://example.invalid",
      sleepIntervalMs: 1,
    };
  },
  readTesterScenario: () => "random-order",
  runTesterLoop: async ({ ownedTxHash: runtimeOwnedTxHash }) => {
    await Promise.resolve();
    if (runtimeOwnedTxHash !== undefined && runtimeOwnedTxHash !== ownedTxHash) {
      throw new Error(`unexpected owned transaction hash: ${runtimeOwnedTxHash}`);
    }
    const record =
      runtimeOwnedTxHash === ownedTxHash
        ? { skip: { reason: "fresh-matchable-order", txHash: ownedTxHash } }
        : {
            actions: {
              testerScenario: "random-order",
              newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" },
            },
            txHash: emittedTxHash,
          };
    process.stdout.write(`${JSON.stringify(record)}\n`);
  },
  signerAccountLocks: async () => {
    await Promise.resolve();
    return [];
  },
  verifyChainPreflight: async () => {
    await Promise.resolve();
    return {
      chain: "testnet",
      expected: {
        addressPrefix: "ckt",
        chain: "testnet",
        genesisHash: ownedTxHash,
        genesisMessage: "test",
        genesisSource: "test",
        networkName: "ckb_testnet",
      },
      observed: {
        addressPrefix: "ckt",
        genesisHash: ownedTxHash,
        tip: { hash: ownedTxHash, number: 1n, timestamp: 1n },
      },
      matches: { addressPrefix: true, genesisHash: true },
    };
  },
  createSdk: (config) => IckbSdk.fromConfig(config),
};

const entrypointPath = process.argv[1];
if (entrypointPath === undefined) {
  throw new Error("missing tester fixture entrypoint path");
}
await runTesterEntrypoint(
  process.argv,
  pathToFileURL(entrypointPath).href,
  async (argv): Promise<void> => {
    await runTesterCli(argv, process.env, dependencies);
  },
);
