import { ccc } from "@ckb-ccc/core";
import { pathToFileURL } from "node:url";
import { ICKB_DEPOSIT_CAP, convert } from "@ickb/core";
import {
  getConfig,
  IckbSdk,
  projectAccountAvailability,
  sendAndWaitForCommit,
} from "@ickb/sdk";
import {
  createPublicClient,
  formatCkb,
  handleLoopError,
  logExecution,
  parseSleepInterval,
  parseSupportedChain,
  signerAccountLocks,
  sleep,
  STOP_EXIT_CODE,
} from "@ickb/node-utils";
import {
  buildTransaction,
  collectPoolDeposits,
  type BotState,
  type Runtime,
} from "./runtime.js";

async function main(): Promise<void> {
  const { CHAIN, RPC_URL, BOT_PRIVATE_KEY, BOT_SLEEP_INTERVAL } = process.env;
  if (!CHAIN) {
    throw new Error("Invalid env CHAIN: Empty");
  }
  if (!BOT_PRIVATE_KEY) {
    throw new Error("Empty env BOT_PRIVATE_KEY");
  }
  const sleepInterval = parseSleepInterval(BOT_SLEEP_INTERVAL, "BOT_SLEEP_INTERVAL");

  const chain = parseSupportedChain(CHAIN, "CHAIN");
  const client = createPublicClient(chain, RPC_URL);
  const config = getConfig(chain);
  const { managers } = config;
  const signer = new ccc.SignerCkbPrivateKey(client, BOT_PRIVATE_KEY);
  const recommendedAddress = await signer.getRecommendedAddressObj();
  const primaryLock = recommendedAddress.script;
  const runtime: Runtime = {
    chain,
    client,
    signer,
    sdk: IckbSdk.fromConfig(config),
    managers,
    primaryLock,
  };
  let stopAfterLog = false;
  for (;;) {
    await sleep(Math.floor(2 * Math.random() * sleepInterval));

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const executionLog: Record<string, any> = {};
    const startTime = new Date();
    executionLog.startTime = startTime.toLocaleString();

    try {
      const state = await readBotState(runtime);

      executionLog.balance = {
        CKB: {
          total: fmtCkb(state.totalCkbBalance),
          available: fmtCkb(state.availableCkbBalance),
          unavailable: fmtCkb(state.unavailableCkbBalance),
        },
        ICKB: {
          total: fmtCkb(state.availableIckbBalance),
          available: fmtCkb(state.availableIckbBalance),
          unavailable: fmtCkb(0n),
        },
        totalEquivalent: {
          CKB: fmtCkb(
            state.totalCkbBalance +
              convert(false, state.availableIckbBalance, state.system.tip),
          ),
          ICKB: fmtCkb(
            convert(true, state.totalCkbBalance, state.system.tip) +
              state.availableIckbBalance,
          ),
        },
      };
      executionLog.ratio = state.system.exchangeRatio;

      if (
        state.totalCkbBalance +
          convert(false, state.availableIckbBalance, state.system.tip) <=
        state.minCkbBalance
      ) {
        executionLog.error =
          "The bot must have more than " +
          fmtCkb(state.minCkbBalance) +
          " CKB worth of capital to be able to operate, shutting down...";
        process.exitCode = STOP_EXIT_CODE;
        logExecution(executionLog, startTime);
        return;
      }

      const result = await buildTransaction(runtime, state);
      if (!result) {
        continue;
      }

      executionLog.actions = result.actions;
      executionLog.txFee = {
        fee: fmtCkb(result.tx.estimateFee(state.system.feeRate)),
        feeRate: state.system.feeRate,
      };
      executionLog.txHash = await sendAndWaitForCommit(runtime, result.tx, {
        onSent: (txHash) => {
          executionLog.txHash = txHash;
        },
      });
    } catch (error) {
      stopAfterLog = handleLoopError(executionLog, error);
    }

    logExecution(executionLog, startTime);
    if (stopAfterLog) {
      return;
    }
  }
}

async function readBotState(runtime: Runtime): Promise<BotState> {
  const accountLocks = await signerAccountLocks(runtime.signer, runtime.primaryLock);
  const { system, user, account } = await runtime.sdk.getL1AccountState(
    runtime.client,
    accountLocks,
  );
  const poolDeposits = await collectPoolDeposits(
    runtime.client,
    runtime.managers.logic,
    system.tip,
  );
  await runtime.sdk.assertCurrentTip(runtime.client, system.tip);

  const projection = projectAccountAvailability(account, user.orders, {
    collectedOrdersAvailable: true,
  });
  const ownedOrderKeys = new Set(
    user.orders.map((group) => outPointKey(group.order.cell.outPoint)),
  );
  const marketOrders = system.orderPool.filter(
    (order) => !ownedOrderKeys.has(outPointKey(order.cell.outPoint)),
  );

  const availableCkbBalance = projection.ckbAvailable;
  const availableIckbBalance = projection.ickbAvailable;
  const unavailableCkbBalance = projection.ckbPending;
  const totalCkbBalance = availableCkbBalance + unavailableCkbBalance;
  const depositCapacity = convert(false, ICKB_DEPOSIT_CAP, system.exchangeRatio);

  return {
    accountLocks,
    system,
    userOrders: user.orders,
    marketOrders,
    receipts: account.receipts,
    readyWithdrawals: projection.readyWithdrawals,
    notReadyWithdrawals: projection.pendingWithdrawals,
    readyPoolDeposits: poolDeposits.ready,
    nearReadyPoolDeposits: poolDeposits.nearReady,
    futurePoolDeposits: poolDeposits.future,
    availableCkbBalance,
    availableIckbBalance,
    unavailableCkbBalance,
    totalCkbBalance,
    depositCapacity,
    minCkbBalance: (21n * depositCapacity) / 20n,
  };
}

function outPointKey(outPoint: ccc.OutPoint): string {
  return ccc.hexFrom(outPoint.toBytes());
}

const fmtCkb = formatCkb;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
