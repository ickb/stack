import { ccc } from "@ckb-ccc/core";
import { getConfig } from "../../src/constants.ts";
import { IckbSdk } from "../../src/sdk.ts";
import {
  signAndSendTransaction,
  signerAccountLocks,
} from "../../src/send/sign_and_send_transaction.ts";
import { BotEventEmitter, createRunId } from "./bot/events.ts";
import { runBotTurn } from "./bot/turn.ts";
import type { Runtime } from "./bot/types.ts";
import { createPublicClient, verifyChainPreflight } from "./shared/chain.ts";
import { readRuntimeConfigEnv } from "./shared/runtime_config.ts";

// One process is one bot turn: read config, connect, act at most once, exit.
const { chain, privateKey, rpcUrl, rpcEndpoint } = await readRuntimeConfigEnv(
  process.env,
  "BOT",
);
const events = new BotEventEmitter({ chain, runId: createRunId() });
events.emit({ type: "bot.turn.started" });
let clientOwner: ccc.Owner<ccc.Client> | undefined;
try {
  clientOwner = createPublicClient(chain, rpcUrl);
  const client = clientOwner.value;
  const preflight = await verifyChainPreflight(client, chain);
  const managers = getConfig(chain);
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
      rpcEndpoint,
    },
    expected: preflight.expected,
    observed: preflight.observed,
    matches: preflight.matches,
  });
  const sdk = new IckbSdk(managers);
  const runtime: Runtime = {
    client,
    sdk,
    managers,
    primaryLock,
    accountLocks: await signerAccountLocks(signer, primaryLock),
    completeTransaction: async (tx, feeRate, cells) =>
      sdk.completeTransaction(tx, { signer, feeRate, cells }),
    sendTransaction: async (tx, recordTxHash, broadcastBefore) =>
      signAndSendTransaction(signer, tx, recordTxHash, broadcastBefore),
  };
  await runBotTurn({ events, runtime });
} catch (error) {
  // Every failure is safe to follow with a fresh turn: it rebuilds from committed state, and
  // a transaction still pending from this turn conflicts with the rebuilt one at the node.
  events.emit({ type: "bot.turn.failed", error });
  process.exitCode = 1;
} finally {
  // Closes the sockets the client opened, so nothing keeps the finished turn alive.
  await clientOwner?.dispose();
}
// The disposed client leaves nothing on the event loop, so the turn ends here on its own.
process.exitCode ??= 0;
