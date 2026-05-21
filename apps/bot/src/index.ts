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
  randomSleepIntervalMs,
  readRuntimeConfigEnv,
  reachedMaxIterations,
  signerAccountLocks,
  sleep,
  STOP_EXIT_CODE,
  type RuntimeConfig,
  type SecretRedactionContext,
  verifyChainPreflight,
} from "@ickb/node-utils";
import {
  buildTransaction,
  collectPoolDeposits,
  summarizeBotState,
  type BotState,
  type Runtime,
} from "./runtime.js";
import {
  BotEventEmitter,
  createRunId,
  emitDecisionEvents,
  errorSummary,
  lowCapitalSkipDecision,
  transactionLifecycleEvents,
  transactionSummary,
} from "./observability.js";

async function main(): Promise<void> {
  const runtimeConfig = await readBotRuntimeConfig(process.env);
  const { chain, privateKey, rpcUrl, sleepIntervalMs, maxIterations } = runtimeConfig;
  const secrets = { privateKey, rpcUrl };
  const runId = createRunId();
  const events = new BotEventEmitter({ chain, runId });
  events.emit(0, "bot.run.started", {
    maxIterations,
    bounded: maxIterations !== undefined,
  });
  const client = createPublicClient(chain, rpcUrl);
  await verifyChainPreflight(client, chain);
  const config = getConfig(chain);
  const { managers } = config;
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
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
  let completedIterations = 0;
  let iterationId = 0;
  for (;;) {
    await sleep(randomSleepIntervalMs(sleepIntervalMs));

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const executionLog: Record<string, any> = {};
    const startTime = new Date();
    let stopAfterIteration = false;
    executionLog.startTime = startTime.toLocaleString();
    iterationId += 1;
    events.emit(iterationId, "bot.iteration.started");

    try {
      const state = await readBotState(runtime);
      const stateDecision = summarizeBotState(state);
      events.emit(iterationId, "bot.state.read", {
        chainTip: stateDecision.chainTip,
        balances: stateDecision.balances,
        orders: stateDecision.orders,
        withdrawals: stateDecision.withdrawals,
        poolDeposits: stateDecision.poolDeposits,
        exchangeRatio: stateDecision.exchangeRatio,
        depositCapacity: stateDecision.depositCapacity,
      });

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
          CKB: fmtCkb(stateDecision.balances.totalEquivalentCkb),
          ICKB: fmtCkb(stateDecision.balances.totalEquivalentIckb),
        },
      };
      executionLog.ratio = state.system.exchangeRatio;

      if (stateDecision.balances.totalEquivalentCkb <= state.minCkbBalance) {
        const skip = lowCapitalSkipDecision(stateDecision);
        events.emit(iterationId, "bot.decision.skipped", skip);
        executionLog.error =
          "The bot must have more than " +
          fmtCkb(state.minCkbBalance) +
          " CKB worth of capital to be able to operate, shutting down...";
        process.exitCode = STOP_EXIT_CODE;
        logExecution(executionLog, startTime);
        return;
      }

      const result = await buildTransaction(runtime, state);
      emitDecisionEvents(events, iterationId, result);
      if (result.kind === "skipped") {
        executionLog.actions = result.actions;
      } else {
        executionLog.actions = result.actions;
        const fee = result.tx.estimateFee(state.system.feeRate);
        executionLog.txFee = {
          fee: fmtCkb(fee),
          feeRate: state.system.feeRate,
        };
        executionLog.txHash = await sendAndWaitForCommit(runtime, result.tx, {
          onSent: (txHash) => {
            executionLog.txHash = txHash;
          },
          onLifecycle: (event) => {
            for (const lifecycle of transactionLifecycleEvents(event, secrets)) {
              events.emit(iterationId, lifecycle.type, {
                ...lifecycle.fields,
                ...(event.type === "broadcasted"
                  ? { transaction: transactionSummary(result.tx, fee, state.system.feeRate) }
                  : {}),
              });
            }
          },
        });
      }
    } catch (error) {
      stopAfterLog = handleLoopError(executionLog, error, secrets);
      const failure = iterationFailureEventFields(error, secrets);
      events.emit(iterationId, "bot.iteration.failed", failure);
      if (failure.retryable) {
        logExecution(executionLog, startTime);
        continue;
      }
    }

    const completion = completeTerminalIteration(completedIterations, maxIterations);
    completedIterations = completion.completedIterations;
    stopAfterIteration = completion.shouldStop;

    logExecution(executionLog, startTime);
    if (stopAfterLog) {
      return;
    }
    if (stopAfterIteration) {
      return;
    }
  }
}

export async function readBotRuntimeConfig(env: NodeJS.ProcessEnv): Promise<RuntimeConfig> {
  return readRuntimeConfigEnv(env.BOT_CONFIG_FILE, "BOT_CONFIG_FILE");
}

export function completeTerminalIteration(
  completedIterations: number,
  maxIterations: number | undefined,
): { completedIterations: number; shouldStop: boolean } {
  const nextCompletedIterations = completedIterations + 1;
  return {
    completedIterations: nextCompletedIterations,
    shouldStop: reachedMaxIterations(nextCompletedIterations, maxIterations),
  };
}

export function iterationFailureEventFields(error: unknown, secrets: SecretRedactionContext = {}): {
  error: Record<string, unknown> | string;
  retryable: boolean;
  terminal: boolean;
} {
  const retryable = isRetryableBotError(error);
  return {
    error: errorSummary(error, secrets),
    retryable,
    terminal: !retryable,
  };
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
    capacityCells: account.capacityCells,
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

export function isRetryableBotError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.includes("L1 state scan crossed chain tip") ||
    (error instanceof TypeError && error.message === "fetch failed")
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
  process.exit(process.exitCode ?? 0);
}
