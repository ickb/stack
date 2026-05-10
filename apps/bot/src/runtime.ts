import { ccc } from "@ckb-ccc/core";
import {
  type IckbDepositCell,
  type ReceiptCell,
  type WithdrawalGroup,
} from "@ickb/core";
import {
  OrderManager,
  type OrderCell,
  type OrderGroup,
} from "@ickb/order";
import { type getConfig, type IckbSdk, type SystemState } from "@ickb/sdk";
import { defaultFindCellsLimit } from "@ickb/utils";
import { partitionPoolDeposits, planRebalance } from "./policy.js";

const MATCH_STEP_DIVISOR = 100n;
const MAX_OUTPUTS_BEFORE_CHANGE = 58;

export interface Runtime {
  chain: SupportedChain;
  client: ccc.Client;
  signer: ccc.SignerCkbPrivateKey;
  sdk: IckbSdk;
  managers: ReturnType<typeof getConfig>["managers"];
  primaryLock: ccc.Script;
}

export interface BotState {
  accountLocks: ccc.Script[];
  system: SystemState;
  userOrders: OrderGroup[];
  marketOrders: OrderCell[];
  receipts: ReceiptCell[];
  readyWithdrawals: WithdrawalGroup[];
  notReadyWithdrawals: WithdrawalGroup[];
  readyPoolDeposits: IckbDepositCell[];
  nearReadyPoolDeposits: IckbDepositCell[];
  futurePoolDeposits: IckbDepositCell[];
  availableCkbBalance: bigint;
  availableIckbBalance: bigint;
  unavailableCkbBalance: bigint;
  totalCkbBalance: bigint;
  depositCapacity: bigint;
  minCkbBalance: bigint;
}

export type SupportedChain = "mainnet" | "testnet";

const POOL_MIN_LOCK_UP = ccc.Epoch.from([0n, 1n, 16n]);
const POOL_MAX_LOCK_UP = ccc.Epoch.from([0n, 4n, 16n]);

export function parseSleepInterval(
  intervalSeconds: string | undefined,
  envName: string,
): number {
  const seconds = Number(intervalSeconds);
  if (intervalSeconds === undefined || !Number.isFinite(seconds) || seconds < 1) {
    throw new Error("Invalid env " + envName);
  }

  return seconds * 1000;
}

export async function buildTransaction(
  runtime: Runtime,
  state: BotState,
): Promise<
  | {
      tx: ccc.Transaction;
      actions: {
        collectedOrders: number;
        completedDeposits: number;
        matchedOrders: number;
        deposits: number;
        withdrawalRequests: number;
        withdrawals: number;
      };
    }
  | undefined
> {
  const match = OrderManager.bestMatch(
    state.marketOrders,
    {
      ckbValue: state.availableCkbBalance,
      udtValue: state.availableIckbBalance,
    },
    state.system.exchangeRatio,
    {
      feeRate: state.system.feeRate,
      ckbAllowanceStep: maxBigInt(1n, state.depositCapacity / MATCH_STEP_DIVISOR),
      maxPartials: MAX_OUTPUTS_BEFORE_CHANGE,
    },
  );
  let tx = ccc.Transaction.default();
  if (match.partials.length > 0) {
    tx = runtime.managers.order.addMatch(tx, match);
  }

  const rebalance = planRebalance({
    outputSlots: Math.max(0, MAX_OUTPUTS_BEFORE_CHANGE - tx.outputs.length),
    tip: state.system.tip,
    ickbBalance: state.availableIckbBalance + match.udtDelta,
    ckbBalance: state.availableCkbBalance + match.ckbDelta,
    depositCapacity: state.depositCapacity,
    readyDeposits: state.readyPoolDeposits,
    nearReadyDeposits: state.nearReadyPoolDeposits,
    futurePoolDeposits: state.futurePoolDeposits,
  });
  tx = await runtime.sdk.buildBaseTransaction(tx, runtime.client, {
    withdrawalRequest:
      rebalance.kind === "withdraw"
        ? {
            deposits: rebalance.deposits,
            requiredLiveDeposits: rebalance.requiredLiveDeposits,
            lock: runtime.primaryLock,
          }
        : undefined,
    orders: state.userOrders,
    receipts: state.receipts,
    readyWithdrawals: state.readyWithdrawals,
  });
  if (rebalance.kind === "deposit") {
    tx = await runtime.managers.logic.deposit(
      tx,
      rebalance.quantity,
      state.depositCapacity,
      runtime.primaryLock,
      runtime.client,
    );
  }

  const actions = {
    collectedOrders: state.userOrders.length,
    completedDeposits: state.receipts.length,
    matchedOrders: match.partials.length,
    deposits:
      rebalance.kind === "deposit" ? rebalance.quantity : 0,
    withdrawalRequests:
      rebalance.kind === "withdraw" ? rebalance.deposits.length : 0,
    withdrawals: state.readyWithdrawals.length,
  };
  const actionCount = Object.values(actions).reduce((sum, count) => sum + count, 0);
  if (actionCount === 0) {
    return;
  }

  tx = await runtime.sdk.completeTransaction(tx, {
    signer: runtime.signer,
    client: runtime.client,
    feeRate: state.system.feeRate,
  });

  if (isMatchOnly(actions)) {
    const fee = await tx.getFee(runtime.client);
    const matchValue =
      match.ckbDelta * state.system.exchangeRatio.ckbScale +
      match.udtDelta * state.system.exchangeRatio.udtScale;
    if (matchValue <= fee * state.system.exchangeRatio.ckbScale) {
      return;
    }
  }

  return { tx, actions };
}

export async function collectPoolDeposits(
  client: ccc.Client,
  logic: Runtime["managers"]["logic"],
  tip: ccc.ClientBlockHeader,
): Promise<{
  ready: IckbDepositCell[];
  nearReady: IckbDepositCell[];
  future: IckbDepositCell[];
}> {
  const deposits = await collectAsync(
    logic.findDeposits(client, {
      onChain: true,
      tip,
      minLockUp: POOL_MIN_LOCK_UP,
      maxLockUp: POOL_MAX_LOCK_UP,
      limit: defaultFindCellsLimit + 1,
    }),
  );
  if (deposits.length > defaultFindCellsLimit) {
    throw new Error(
      `iCKB pool deposit scan reached limit ${String(defaultFindCellsLimit)}; state may be incomplete`,
    );
  }

  const readyWindowEnd = POOL_MAX_LOCK_UP.add(tip.epoch).toUnix(tip);

  return partitionPoolDeposits(deposits, tip, readyWindowEnd);
}

function isMatchOnly(actions: {
  collectedOrders: number;
  completedDeposits: number;
  matchedOrders: number;
  deposits: number;
  withdrawalRequests: number;
  withdrawals: number;
}): boolean {
  return (
    actions.matchedOrders > 0 &&
    actions.collectedOrders === 0 &&
    actions.completedDeposits === 0 &&
    actions.deposits === 0 &&
    actions.withdrawalRequests === 0 &&
    actions.withdrawals === 0
  );
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}
