import { ccc } from "@ckb-ccc/core";
import {
  createPublicClient,
  signerAccountLocks,
  verifyChainPreflight,
} from "@ickb/node-utils";
import { getConfig, IckbSdk } from "@ickb/sdk";
import {
  readTesterFeePolicy,
  readTesterRuntimeConfig,
  readTesterScenario,
  runTesterLoop,
  TESTER_OWNED_TX_HASH_FLAG,
  type Runtime,
} from "@ickb/validation";
import { pathToFileURL } from "node:url";

type IckbConfig = ReturnType<typeof getConfig>;

export interface TesterCliDependencies {
  createPublicClient: typeof createPublicClient;
  createSdk: (config: IckbConfig) => IckbSdk;
  getConfig: typeof getConfig;
  readTesterFeePolicy: typeof readTesterFeePolicy;
  readTesterRuntimeConfig: typeof readTesterRuntimeConfig;
  readTesterScenario: typeof readTesterScenario;
  runTesterLoop: typeof runTesterLoop;
  signerAccountLocks: typeof signerAccountLocks;
  verifyChainPreflight: typeof verifyChainPreflight;
}

const defaultDependencies: TesterCliDependencies = {
  createPublicClient,
  createSdk: (config) => IckbSdk.fromConfig(config),
  getConfig,
  readTesterFeePolicy,
  readTesterRuntimeConfig,
  readTesterScenario,
  runTesterLoop,
  signerAccountLocks,
  verifyChainPreflight,
};

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

export async function runTesterEntrypoint(
  argv: string[] = process.argv,
  moduleUrl: string = import.meta.url,
  run: (args: string[]) => Promise<void> = runTesterCli,
): Promise<void> {
  if (argv[1] === undefined || moduleUrl !== pathToFileURL(argv[1]).href) {
    return;
  }

  await run(argv.slice(2));
  process.exitCode ??= 0;
}

export async function runTesterCli(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  dependencies: Partial<TesterCliDependencies> = {},
): Promise<void> {
  const ownedTxHash = parseOwnedTxHash(argv);
  const resolved = { ...defaultDependencies, ...dependencies };
  const {
    chain,
    privateKey,
    rpcUrl,
    sleepIntervalMs,
    maxIterations,
    maxRetryableAttempts,
  } = await resolved.readTesterRuntimeConfig(env);
  const testerScenario = resolved.readTesterScenario(env);
  const feePolicy = resolved.readTesterFeePolicy(env);
  const client = resolved.createPublicClient(chain, rpcUrl);
  await resolved.verifyChainPreflight(client, chain);
  const config = resolved.getConfig(chain);
  // BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
  // - OWNER: secret purpose boundary.
  // - INVARIANT: private keys pass only to signer construction and signing.
  // - FAILURE MODE: passing keys to logs, errors, telemetry, redaction, masking, or test hooks leaks signing authority.
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  const recommendedAddress = await signer.getRecommendedAddressObj();
  const primaryLock = recommendedAddress.script;
  const runtime: Runtime = {
    client,
    signer,
    sdk: resolved.createSdk(config),
    primaryLock,
    accountLocks: await resolved.signerAccountLocks(signer, primaryLock),
  };

  await resolved.runTesterLoop({
    runtime,
    ownedTxHash,
    testerScenario,
    feePolicy,
    sleepIntervalMs,
    maxIterations,
    maxRetryableAttempts,
  });
}

export function parseOwnedTxHash(argv: string[]): ccc.Hex | undefined {
  if (argv.length === 0) {
    return undefined;
  }
  if (argv[0] !== TESTER_OWNED_TX_HASH_FLAG) {
    throw new Error(`Unknown argument: ${String(argv[0])}`);
  }
  const value = argv[1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${TESTER_OWNED_TX_HASH_FLAG}`);
  }
  if (!TX_HASH_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${TESTER_OWNED_TX_HASH_FLAG}: expected a 0x-prefixed 64-digit transaction hash`,
    );
  }
  if (argv.length !== 2) {
    throw new Error(
      argv[2] === TESTER_OWNED_TX_HASH_FLAG
        ? `Duplicate argument: ${TESTER_OWNED_TX_HASH_FLAG}`
        : `Unknown argument: ${String(argv[2])}`,
    );
  }
  return ccc.hexFrom(value.toLowerCase());
}

// eslint-disable-next-line unicorn/no-top-level-side-effects -- CLI module runs only when imported as the process entrypoint.
await runTesterEntrypoint();
