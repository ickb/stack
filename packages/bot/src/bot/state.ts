import { ccc } from "@ckb-ccc/core";
import { convert, ICKB_DEPOSIT_CAP } from "@ickb/core";
import { signerAccountLocks } from "@ickb/node-utils";
import { projectAccountAvailability } from "@ickb/sdk";
import { POOL_MAX_LOCK_UP, POOL_MIN_LOCK_UP } from "../policy.ts";
import type { BotState, Runtime } from "../runtime/types.ts";

/**
 * Reads bot-owned account state and public market state for one planning attempt.
 *
 * @remarks Own orders are excluded from the market side, and pool deposits must
 * come from the same L1 snapshot used for account projection.
 */
export async function readBotState(runtime: Runtime): Promise<BotState> {
  const accountLocks = await signerAccountLocks(runtime.signer, runtime.primaryLock);
  const { system, user, account } = await runtime.sdk.getL1AccountState(
    runtime.client,
    accountLocks,
    {
      poolDeposits: {
        minLockUp: POOL_MIN_LOCK_UP,
        maxLockUp: POOL_MAX_LOCK_UP,
      },
    },
  );
  if (system.poolDeposits === undefined) {
    throw new Error("L1 account state is missing pool deposit snapshot");
  }
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
    system,
    userOrders: user.orders,
    marketOrders,
    receipts: account.receipts,
    readyWithdrawals: projection.readyWithdrawals,
    notReadyWithdrawals: projection.pendingWithdrawals,
    poolDeposits: system.poolDeposits.deposits,
    readyPoolDeposits: system.poolDeposits.readyDeposits,
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
