import type { ccc } from "@ckb-ccc/core";
import { setTimeout as sleep } from "node:timers/promises";
import { getConfig } from "../../src/constants.ts";
import { BOT_TURN_MS } from "../../src/conversion/maturity.ts";
import { IckbSdk } from "../../src/sdk.ts";
import { signAndSendTransaction } from "../../src/send/sign_and_send_transaction.ts";
import { readBotMaxFeeRate } from "./bot/config.ts";
import { BotEventEmitter, createProcessId } from "./bot/events.ts";
import { runBotTurn } from "./bot/turn.ts";
import type { Runtime } from "./bot/types.ts";
import { createPublicClient, verifyChainPreflight } from "./shared/chain.ts";
import { readRuntimeConfigEnv } from "./shared/runtime_config.ts";
import { keyAccount } from "./shared/signer.ts";

// One process runs turns for six hours or until one fails: read config and connect once, then
// act at most once per turn, a turn starting BOT_TURN_MS after the previous one started.
// Any failure exits 1 and the six hours exit 0; either way systemd restarts a clean process.
const TURN_INTERVAL_MS = Number(BOT_TURN_MS);
// Six hours bound what one process can carry that no failure clears, such as a fallback
// endpoint it stays on while that node lags, or a cached invented header. Wall clock on
// purpose: it keeps counting through a host suspend, as cached state ages.
const PROCESS_MAX_MS = 6 * 60 * 60_000;
const processStarted = Date.now();
const { chain, privateKeys, rpcUrls, rpcEndpoints } = await readRuntimeConfigEnv(
  process.env,
  "BOT",
);
const maxFeeRate = readBotMaxFeeRate(process.env);
const events = new BotEventEmitter({ chain, processId: createProcessId() });
events.emit({ type: "bot.turn.started" });
let clientOwner: ccc.Owner<ccc.Client> | undefined;
try {
  clientOwner = createPublicClient(chain, rpcUrls);
  const client = clientOwner.value;
  await verifyChainPreflight(client, chain);
  const managers = getConfig(chain);
  const { signer, address, primaryLock, accountLocks } = await keyAccount(
    client,
    privateKeys,
  );
  events.emit({
    type: "bot.chain.preflight",
    identity: { address, primaryLock, rpcEndpoints },
  });
  const sdk = new IckbSdk(managers);
  const runtime: Runtime = {
    client,
    sdk,
    managers,
    primaryLock,
    accountLocks,
    ...(maxFeeRate === undefined ? {} : { maxFeeRate }),
    completeTransaction: async (tx, { system, receipts, cells }) =>
      sdk.completeTransaction(tx, { signer, system, receipts, cells }),
    sendTransaction: async (tx, plannedFee, broadcastBefore) =>
      signAndSendTransaction(signer, tx, plannedFee, undefined, broadcastBefore),
  };
  for (;;) {
    const started = Date.now();
    await runBotTurn({ events, runtime });
    // Checked before the sleep: the unit's restart delay then keeps the usual cadence.
    if (Date.now() - processStarted >= PROCESS_MAX_MS) {
      break;
    }
    // Capped at the interval: a wall clock stepped back between turns would otherwise
    // stretch the sleep by the step, up to the unit's runtime limit.
    await sleep(
      Math.min(TURN_INTERVAL_MS, Math.max(0, started + TURN_INTERVAL_MS - Date.now())),
    );
    events.emit({ type: "bot.turn.started" });
  }
} catch (error) {
  // Every failure is safe to follow with a fresh turn: it rebuilds from committed state, and
  // a transaction still pending from this turn conflicts with the rebuilt one at the node.
  events.emit({ type: "bot.turn.failed", error });
  process.exitCode = 1;
} finally {
  // Closes the sockets the client opened, so nothing keeps the ending process alive.
  await clientOwner?.dispose();
}
