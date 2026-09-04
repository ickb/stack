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
  runTesterTurn,
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
  runTesterTurn: typeof runTesterTurn;
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
  runTesterTurn,
  signerAccountLocks,
  verifyChainPreflight,
};

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
  if (argv.length > 0) {
    throw new Error(`Unknown argument: ${String(argv[0])}`);
  }
  const resolved = { ...defaultDependencies, ...dependencies };
  const { chain, privateKey, rpcUrl } = await resolved.readTesterRuntimeConfig(env);
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

  await resolved.runTesterTurn({
    runtime,
    testerScenario,
    feePolicy,
  });
}

// eslint-disable-next-line unicorn/no-top-level-side-effects -- CLI module runs only when imported as the process entrypoint.
await runTesterEntrypoint();
