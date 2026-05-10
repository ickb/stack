import { ccc } from "@ckb-ccc/core";
import { pathToFileURL } from "node:url";
import { ICKB_DEPOSIT_CAP, convert } from "@ickb/core";
import {
  getConfig,
  IckbSdk,
  projectAccountAvailability,
  sendAndWaitForCommit,
  TransactionConfirmationError,
} from "@ickb/sdk";
import {
  buildTransaction,
  collectPoolDeposits,
  parseSleepInterval,
  type BotState,
  type Runtime,
  type SupportedChain,
} from "./runtime.js";
import { formatCkb, jsonLogReplacer } from "./log.js";

const STOP_EXIT_CODE = 2;

async function main(): Promise<void> {
  const { CHAIN, RPC_URL, BOT_PRIVATE_KEY, BOT_SLEEP_INTERVAL } = process.env;
  if (!CHAIN) {
    throw new Error("Invalid env CHAIN: Empty");
  }
  if (!BOT_PRIVATE_KEY) {
    throw new Error("Empty env BOT_PRIVATE_KEY");
  }
  const sleepInterval = parseSleepInterval(BOT_SLEEP_INTERVAL, "BOT_SLEEP_INTERVAL");

  const chain = parseChain(CHAIN);
  const client = createClient(chain, RPC_URL);
  const config = getConfig(chain);
  const { managers } = config;
  const signer = new ccc.SignerCkbPrivateKey(client, BOT_PRIVATE_KEY);
  const primaryLock = (await signer.getRecommendedAddressObj()).script;
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
        console.log(JSON.stringify(executionLog, jsonLogReplacer, " "));
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
      executionLog.error = errorToLog(error);
      if (error instanceof TransactionConfirmationError && error.isTimeout) {
        process.exitCode = STOP_EXIT_CODE;
        stopAfterLog = true;
      }
    }

    executionLog.ElapsedSeconds = Math.round(
      (Date.now() - startTime.getTime()) / 1000,
    );
    console.log(JSON.stringify(executionLog, jsonLogReplacer, " "));
    if (stopAfterLog) {
      return;
    }
  }
}

async function readBotState(runtime: Runtime): Promise<BotState> {
  const accountLocks = dedupeScripts(
    (await runtime.signer.getAddressObjs()).map(({ script }) => script),
  );
  const { system, user } = await runtime.sdk.getL1State(
    runtime.client,
    accountLocks,
  );

  const [account, poolDeposits] = await Promise.all([
    runtime.sdk.getAccountState(runtime.client, accountLocks, system.tip),
    collectPoolDeposits(runtime.client, runtime.managers.logic, system.tip),
  ]);

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

function createClient(chain: SupportedChain, rpcUrl: string | undefined): ccc.Client {
  const config = rpcUrl ? { url: rpcUrl } : undefined;
  return chain === "mainnet"
    ? new ccc.ClientPublicMainnet(config)
    : new ccc.ClientPublicTestnet(config);
}

function parseChain(chain: string): SupportedChain {
  if (chain === "mainnet" || chain === "testnet") {
    return chain;
  }

  throw new Error("Invalid env CHAIN: " + chain);
}

function dedupeScripts(scripts: ccc.Script[]): ccc.Script[] {
  const seen = new Set<string>();
  const unique: ccc.Script[] = [];

  for (const script of scripts) {
    const key = script.toHex();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(script);
  }

  return unique;
}

function outPointKey(outPoint: ccc.OutPoint): string {
  return ccc.hexFrom(outPoint.toBytes());
}

const fmtCkb = formatCkb;

function errorToLog(error: unknown): unknown {
  if (error instanceof Object && "stack" in error) {
    const stack = error.stack ?? "";
    return {
      name: "name" in error ? error.name : undefined,
      message:
        "message" in error && typeof error.message === "string"
          ? error.message
          : "Unknown error",
      txHash: "txHash" in error ? error.txHash : undefined,
      status: "status" in error ? error.status : undefined,
      stack,
    };
  }

  return error ?? "Empty Error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
