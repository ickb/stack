import { projectAccountAvailability } from "../../../src/conversion/projection.ts";
import { convert, ICKB_DEPOSIT_CAP } from "../../../src/core/index.ts";
import { POOL_MAX_LOCK_UP, POOL_MIN_LOCK_UP } from "./policy.ts";
import type { BotState, Runtime } from "./runtime/types.ts";

/**
 * Reads bot-owned account state and public market state for one planning attempt.
 *
 * @remarks The bot places no orders, so nothing here counts or collects any; the market
 * side of the state is every order past par (decisions amendment 52(ak)).
 */
export async function readBotState(runtime: Runtime): Promise<BotState> {
  const { system, account } = await runtime.sdk.getL1AccountState(
    runtime.client,
    runtime.accountLocks,
    { poolDeposits: { minLockUp: POOL_MIN_LOCK_UP, maxLockUp: POOL_MAX_LOCK_UP } },
  );
  const projection = projectAccountAvailability(account, { available: [], pending: [] });

  return {
    system,
    marketOrders: system.orderPool,
    receipts: account.receipts,
    readyWithdrawals: projection.readyWithdrawals,
    notReadyWithdrawals: projection.pendingWithdrawals,
    poolDeposits: system.poolDeposits,
    cells: [...account.capacityCells, ...account.nativeUdtCells],
    ckb: projection.ckbAvailable,
    ickb: projection.ickbAvailable,
    pendingCkb: projection.ckbPending,
    depositCapacity: convert(false, ICKB_DEPOSIT_CAP, system.exchangeRatio),
  };
}
