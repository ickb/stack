import { ccc } from "@ckb-ccc/core";
import { getConfig } from "../../src/constants.ts";
import { signerAccountLocks } from "../../src/conversion/account_locks.ts";
import { IckbSdk } from "../../src/sdk.ts";
import { signAndSendTransaction } from "../../src/send/sign_and_send_transaction.ts";
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
const events = new BotEventEmitter({ chain, runId: createRunId() });
events.emit({ type: "bot.turn.started" });
let clientOwner: ccc.Owner<ccc.Client> | undefined;
try {
  clientOwner = createPublicClient(chain, rpcUrl);
  const client = clientOwner.value;
  const preflight = await verifyChainPreflight(client, chain);
  const config = getConfig(chain);
  // BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
  // - OWNER: secret purpose boundary.
  // - INVARIANT: private keys pass only to signer construction and signing.
  // - FAILURE MODE: passing keys to logs, events, telemetry, redaction, masking, or test hooks leaks signing authority.
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  const address = await signer.getRecommendedAddressObj();
  const primaryLock = address.script;
  events.emit({
    type: "bot.chain.preflight",
    identity: {
      address: address.toString(),
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
  const sdk = new IckbSdk({
    ickbUdt: config.managers.ickbUdt,
    ownedOwner: config.managers.ownedOwner,
    ickbLogic: config.managers.logic,
    order: config.managers.order,
  });
  const runtime: Runtime = {
    client,
    sdk,
    managers: config.managers,
    primaryLock,
    accountLocks: await signerAccountLocks(signer, primaryLock),
    completeTransaction: async (tx, feeRate, cells) =>
      sdk.completeTransaction(tx, { signer, feeRate, cells }),
    sendTransaction: async (tx, recordTxHash) =>
      signAndSendTransaction(signer, tx, recordTxHash),
  };
  await runBotTurn({ events, runtime });
} catch (error) {
  handleTurnFailure(events, error);
} finally {
  // Closes the sockets the client opened, so nothing keeps the finished turn alive.
  await clientOwner?.dispose();
}
// The disposed client leaves nothing on the event loop, so the turn ends here on its own.
process.exitCode ??= 0;
