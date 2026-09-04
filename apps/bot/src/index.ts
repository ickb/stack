import { ccc } from "@ckb-ccc/core";
import {
  BotEventEmitter,
  createRunId,
  readBotRuntimeConfig,
  runBotTurn,
  type BotTurnContext,
  type Runtime,
} from "@ickb/bot";
import {
  createPublicClient,
  publicRpcEndpointIdentity,
  signerAccountLocks,
  verifyChainPreflight,
} from "@ickb/node-utils";
import { getConfig, IckbSdk, signAndSendTransaction } from "@ickb/sdk";
import { pathToFileURL } from "node:url";

type BotRuntimeConfig = Awaited<ReturnType<typeof readBotRuntimeConfig>>;
type IckbConfig = ReturnType<typeof getConfig>;
const BOT_RUN_ID_PATTERN = /^[\w.:-]+$/u;
const BOT_RUN_ID_MAX_LENGTH = 128;

export interface BotCliDependencies {
  createEvents: (context: {
    artifactRefPrefix?: string;
    artifactRoot?: string;
    chain: BotRuntimeConfig["chain"];
    runId: string;
  }) => BotEventEmitter;
  createPublicClient: typeof createPublicClient;
  createRunId: typeof createRunId;
  createSdk: (config: IckbConfig) => IckbSdk;
  getConfig: typeof getConfig;
  readBotRuntimeConfig: typeof readBotRuntimeConfig;
  runBotTurn: typeof runBotTurn;
  verifyChainPreflight: typeof verifyChainPreflight;
}

const defaultDependencies: BotCliDependencies = {
  createEvents: (context) => new BotEventEmitter(context),
  createPublicClient,
  createRunId,
  createSdk: (config) => IckbSdk.fromConfig(config),
  getConfig,
  readBotRuntimeConfig,
  runBotTurn,
  verifyChainPreflight,
};

export async function runBotEntrypoint(
  argv: string[] = process.argv,
  moduleUrl: string = import.meta.url,
  run: () => Promise<void> = runBotCli,
): Promise<void> {
  if (argv[1] === undefined || moduleUrl !== pathToFileURL(argv[1]).href) {
    return;
  }

  await run();
  process.exitCode ??= 0;
}

export async function runBotCli(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: Partial<BotCliDependencies> = {},
): Promise<void> {
  const resolved = { ...defaultDependencies, ...dependencies };
  const context = await initializeBot(env, resolved);
  await resolved.runBotTurn(context);
}

export async function initializeBot(
  env: NodeJS.ProcessEnv,
  dependencies: BotCliDependencies = defaultDependencies,
): Promise<BotTurnContext> {
  const runtimeConfig = await dependencies.readBotRuntimeConfig(env);
  const { chain, privateKey, rpcUrl } = runtimeConfig;
  const runId = botRunId(env, dependencies.createRunId);
  const artifactRoot = env["BOT_ARTIFACT_ROOT"];
  const artifactRefPrefix = env["BOT_ARTIFACT_REF_PREFIX"];
  const events = dependencies.createEvents({
    chain,
    runId,
    ...(artifactRoot === undefined ? {} : { artifactRoot }),
    ...(artifactRefPrefix === undefined ? {} : { artifactRefPrefix }),
  });
  events.emit(0, "bot.run.started");
  const client = dependencies.createPublicClient(chain, rpcUrl);
  const preflight = await dependencies.verifyChainPreflight(client, chain);
  const config = dependencies.getConfig(chain);
  const { managers } = config;
  // BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
  // - OWNER: secret purpose boundary.
  // - INVARIANT: private keys pass only to signer construction and signing.
  // - FAILURE MODE: passing keys to logs, errors, telemetry, redaction, masking, or test hooks leaks signing authority.
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  const recommendedAddress = await signer.getRecommendedAddressObj();
  const primaryLock = recommendedAddress.script;
  events.emit(0, "bot.chain.preflight", {
    identity: {
      chain,
      primaryLock: {
        codeHash: primaryLock.codeHash,
        hashType: primaryLock.hashType,
        args: primaryLock.args,
      },
      rpcEndpoint: publicRpcEndpointIdentity(rpcUrl),
    },
    expected: preflight.expected,
    observed: preflight.observed,
    matches: preflight.matches,
  });
  const accountLocks = await signerAccountLocks(signer, primaryLock);
  const sdk = dependencies.createSdk(config);
  const runtime: Runtime = {
    client,
    sdk,
    managers,
    primaryLock,
    accountLocks,
    completeTransaction: async (tx, feeRate) =>
      sdk.completeTransaction(tx, { signer, feeRate }),
    sendTransaction: async (tx, recordTxHash) =>
      signAndSendTransaction(signer, tx, recordTxHash),
  };

  return { events, runtime };
}

function botRunId(env: NodeJS.ProcessEnv, fallback: () => string): string {
  const runId = env["BOT_RUN_ID"];
  if (runId === undefined) {
    return fallback();
  }
  if (runId.length > BOT_RUN_ID_MAX_LENGTH || !BOT_RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      "Invalid env BOT_RUN_ID: expected 1-128 characters matching [A-Za-z0-9._:-]+",
    );
  }
  return runId;
}

// eslint-disable-next-line unicorn/no-top-level-side-effects -- CLI module runs only when imported as the process entrypoint.
await runBotEntrypoint();
