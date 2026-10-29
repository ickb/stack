import { ccc } from "@ckb-ccc/core";
import { setTimeout as sleep } from "node:timers/promises";
import { getConfig } from "../../src/constants.ts";
import { IckbSdk } from "../../src/sdk.ts";
import {
  signAndSendTransaction,
  signerAccountLocks,
} from "../../src/send/sign_and_send_transaction.ts";
import { readBotMaxFeeRate } from "./bot/config.ts";
import { BotEventEmitter, createRunId } from "./bot/events.ts";
import { runBotTurn } from "./bot/turn.ts";
import type { Runtime } from "./bot/types.ts";
import { createPublicClient, verifyChainPreflight } from "./shared/chain.ts";
import { readRuntimeConfigEnv } from "./shared/runtime_config.ts";

// One process runs turns until one fails: read config and connect once, then act at most
// once per turn, a turn starting ten minutes after the previous one started. Any failure
// exits, so systemd restarts a clean process, which also picks up an updated checkout.
const TURN_INTERVAL_MS = 10 * 60_000;
const { chain, privateKey, rpcUrls, rpcEndpoint } = await readRuntimeConfigEnv(
  process.env,
  "BOT",
);
const maxFeeRate = readBotMaxFeeRate(process.env);
const events = new BotEventEmitter({ chain, runId: createRunId() });
events.emit({ type: "bot.turn.started" });
let clientOwner: ccc.Owner<ccc.Client> | undefined;
try {
  clientOwner = createPublicClient(chain, rpcUrls);
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
    ...(maxFeeRate === undefined ? {} : { maxFeeRate }),
    completeTransaction: async (tx, feeRate, cells, protocolCells, tip) =>
      sdk.completeTransaction(tx, { signer, feeRate, cells, protocolCells, tip }),
    sendTransaction: async (tx, recordTxHash, broadcastBefore) =>
      signAndSendTransaction(signer, tx, recordTxHash, broadcastBefore),
  };
  for (;;) {
    const started = Date.now();
    await runBotTurn({ events, runtime });
    await sleep(Math.max(0, started + TURN_INTERVAL_MS - Date.now()));
    events.emit({ type: "bot.turn.started" });
  }
} catch (error) {
  // Every failure is safe to follow with a fresh turn: it rebuilds from committed state, and
  // a transaction still pending from this turn conflicts with the rebuilt one at the node.
  events.emit({ type: "bot.turn.failed", error });
  process.exitCode = 1;
} finally {
  // Closes the sockets the client opened, so nothing keeps the failed process alive.
  await clientOwner?.dispose();
}
