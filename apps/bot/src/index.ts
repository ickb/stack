import { ccc } from "@ckb-ccc/core";
import {
  BotEventEmitter,
  createRunId,
  readBotRuntimeConfig,
  runBotLoop,
  type BotLoopContext,
  type Runtime,
} from "@ickb/bot";
import { createPublicClient, verifyChainPreflight } from "@ickb/node-utils";
import { getConfig, IckbSdk } from "@ickb/sdk";
import { pathToFileURL } from "node:url";

type BotRuntimeConfig = Awaited<ReturnType<typeof readBotRuntimeConfig>>;
type IckbConfig = ReturnType<typeof getConfig>;

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
  runBotLoop: typeof runBotLoop;
  verifyChainPreflight: typeof verifyChainPreflight;
}

const defaultDependencies: BotCliDependencies = {
  createEvents: (context) => new BotEventEmitter(context),
  createPublicClient,
  createRunId,
  createSdk: (config) => IckbSdk.fromConfig(config),
  getConfig,
  readBotRuntimeConfig,
  runBotLoop,
  verifyChainPreflight,
};

export async function runBotCli(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: Partial<BotCliDependencies> = {},
): Promise<void> {
  const resolved = { ...defaultDependencies, ...dependencies };
  const context = await initializeBot(env, resolved);
  await resolved.runBotLoop(context);
}

export async function initializeBot(
  env: NodeJS.ProcessEnv,
  dependencies: BotCliDependencies = defaultDependencies,
): Promise<BotLoopContext> {
  const runtimeConfig = await dependencies.readBotRuntimeConfig(env);
  const {
    chain,
    privateKey,
    rpcUrl,
    sleepIntervalMs,
    maxIterations,
    maxRetryableAttempts,
  } = runtimeConfig;
  const runId = dependencies.createRunId();
  const artifactRoot = env["BOT_ARTIFACT_ROOT"];
  const artifactRefPrefix = env["BOT_ARTIFACT_REF_PREFIX"];
  const events = dependencies.createEvents({
    chain,
    runId,
    ...(artifactRoot === undefined ? {} : { artifactRoot }),
    ...(artifactRefPrefix === undefined ? {} : { artifactRefPrefix }),
  });
  events.emit(0, "bot.run.started", {
    maxIterations,
    bounded: maxIterations !== undefined,
    runtime: {
      maxIterations,
      bounded: maxIterations !== undefined,
      sleepIntervalMs,
      maxRetryableAttempts,
      rpcConfigured: rpcUrl !== undefined,
    },
  });
  const client = dependencies.createPublicClient(chain, rpcUrl);
  const preflight = await dependencies.verifyChainPreflight(client, chain);
  events.emit(0, "bot.chain.preflight", {
    rpcConfigured: rpcUrl !== undefined,
    expected: preflight.expected,
    observed: preflight.observed,
    matches: preflight.matches,
  });
  const config = dependencies.getConfig(chain);
  const { managers } = config;
  // BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
  // - OWNER: secret purpose boundary.
  // - INVARIANT: private keys pass only to signer construction and signing.
  // - FAILURE MODE: passing keys to logs, errors, telemetry, redaction, masking, or test hooks leaks signing authority.
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  const recommendedAddress = await signer.getRecommendedAddressObj();
  const primaryLock = recommendedAddress.script;
  const runtime: Runtime = {
    chain,
    client,
    signer,
    sdk: dependencies.createSdk(config),
    managers,
    primaryLock,
  };

  return {
    events,
    runtime,
    sleepIntervalMs,
    maxIterations,
    maxRetryableAttempts,
  };
}

function exitProcess(code: NodeJS.Process["exitCode"]): never {
  process.exit(Number(code));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runBotCli();
  exitProcess(process.exitCode ?? 0);
}
