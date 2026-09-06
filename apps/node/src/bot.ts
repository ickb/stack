import { ccc } from "@ckb-ccc/core";
import {
  getConfig,
  IckbSdk,
  signAndSendTransaction,
  signerAccountLocks,
} from "@ickb/sdk";
import {
  BotEventEmitter,
  createRunId,
  handleTurnFailure,
  readBotRuntimeConfig,
  runBotTurn,
  type Runtime,
} from "./bot/index.ts";
import {
  createPublicClient,
  publicRpcEndpointIdentity,
  verifyChainPreflight,
} from "./shared/index.ts";

// One process is one bot turn: read config, connect, act at most once, exit.
const { chain, privateKey, rpcUrl } = await readBotRuntimeConfig(process.env);
const artifactRoot = process.env["BOT_ARTIFACT_ROOT"];
const events = new BotEventEmitter({
  chain,
  runId: createRunId(),
  ...(artifactRoot === undefined ? {} : { artifactRoot }),
});
events.emit("bot.run.started");
try {
  const client = createPublicClient(chain, rpcUrl);
  const preflight = await verifyChainPreflight(client, chain);
  const config = getConfig(chain);
  // BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
  // - OWNER: secret purpose boundary.
  // - INVARIANT: private keys pass only to signer construction and signing.
  // - FAILURE MODE: passing keys to logs, events, telemetry, redaction, masking, or test hooks leaks signing authority.
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  const primaryLock = (await signer.getRecommendedAddressObj()).script;
  events.emit("bot.chain.preflight", {
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
  const sdk = IckbSdk.fromConfig(config);
  const runtime: Runtime = {
    client,
    sdk,
    managers: config.managers,
    primaryLock,
    accountLocks: await signerAccountLocks(signer, primaryLock),
    completeTransaction: async (tx, feeRate) =>
      sdk.completeTransaction(tx, { signer, feeRate }),
    sendTransaction: async (tx, recordTxHash) =>
      signAndSendTransaction(signer, tx, recordTxHash),
  };
  await runBotTurn({ events, runtime });
} catch (error) {
  handleTurnFailure(events, error);
}
process.exitCode ??= 0;
// CCC's fetch transport leaves its 30 s abort timer armed after a failed request, which would keep
// this finished turn alive. Pipes and sockets are asynchronous on POSIX, so exit only once both
// output streams have drained; a bare process.exit() truncates pending output.
await Promise.all(
  [process.stdout, process.stderr].map(
    async (stream) =>
      new Promise<void>((resolve) => {
        stream.write("", () => {
          resolve();
        });
      }),
  ),
);
// eslint-disable-next-line unicorn/no-process-exit -- The turn is over and its output is flushed.
process.exit();
