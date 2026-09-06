import type { ccc } from "@ckb-ccc/core";
import {
  accountPlainCkbBalance,
  convert,
  ICKB_DEPOSIT_CAP,
  projectAccountAvailability,
  projectConversionTransactionContext,
  type AccountState,
  type ConversionTransactionContext,
  type IckbSdk,
  type OrderGroup,
  type SystemState,
} from "@ickb/sdk";
import type { Budgets } from "./draw.ts";

/** Runtime dependencies of one stimulus turn. */
export interface Runtime {
  client: ccc.Client;
  /** Private-key signer; signing is its only secret-bearing purpose. */
  signer: ccc.SignerCkbPrivateKey;
  sdk: IckbSdk;
  primaryLock: ccc.Script;
  accountLocks: ccc.Script[];
}

/** Account and market state read once per turn. */
export interface StimulusState {
  system: SystemState;
  account: AccountState;
  /** Conversion context over the collectable orders only; live orders stay on the book. */
  context: ConversionTransactionContext;
  /** Fulfilled orders plus live orders older than {@link STALE_ORDER_BLOCKS}: melted this turn. */
  collectable: OrderGroup[];
  orders: { live: number; fulfilled: number; stale: number };
  budgets: Budgets;
  plainCkb: bigint;
  totalCkb: bigint;
  totalIckb: bigint;
  /** Every holding in CKB, live orders included, so stale orders never trigger the hold. */
  totalEquivalentCkb: bigint;
  capitalMinimum: bigint;
}

const CKB = 100_000_000n;
/** Plain CKB the account keeps for its own cells and fees. */
export const CKB_RESERVE = 1000n * CKB;
/** Below one twentieth of a deposit the turn holds with exit 2 (decisions amendment 34). */
const CAPITAL_MINIMUM_DIVISOR = 20n;
/** Thirty days of eight-second blocks: an order the bot left that long is cancelled. */
export const STALE_ORDER_BLOCKS = (30n * 24n * 60n * 60n) / 8n;

export async function readStimulusState(runtime: Runtime): Promise<StimulusState> {
  const { system, user, account } = await runtime.sdk.getL1AccountState(
    runtime.client,
    runtime.accountLocks,
  );
  const fulfilled = user.orders.filter((group) => group.order.isFulfilled());
  const live = user.orders.filter((group) => group.order.isMatchable());
  const stale = await staleOrders(runtime.client, live, system.tip.number);
  const collectable = [...fulfilled, ...stale];
  const { context } = projectConversionTransactionContext(system, account, collectable, {
    collectedOrdersAvailable: true,
  });
  const totals = projectAccountAvailability(account, user.orders);
  const depositCapacity = convert(false, ICKB_DEPOSIT_CAP, system.exchangeRatio);
  const ckbBudget = context.ckbAvailable - CKB_RESERVE;
  return {
    system,
    account,
    context,
    collectable,
    orders: { live: live.length, fulfilled: fulfilled.length, stale: stale.length },
    budgets: {
      ckb: ckbBudget > 0n ? ckbBudget : 0n,
      ickb: context.ickbAvailable,
      ratio: system.exchangeRatio,
    },
    plainCkb: accountPlainCkbBalance(account.capacityCells, runtime.accountLocks),
    totalCkb: totals.ckbBalance,
    totalIckb: totals.ickbBalance,
    totalEquivalentCkb:
      totals.ckbBalance + convert(false, totals.ickbBalance, system.exchangeRatio),
    capitalMinimum: depositCapacity / CAPITAL_MINIMUM_DIVISOR,
  };
}

async function staleOrders(
  client: ccc.Client,
  live: OrderGroup[],
  tipNumber: bigint,
): Promise<OrderGroup[]> {
  const stale: OrderGroup[] = [];
  for (const group of live) {
    const origin = await client.getTransaction(group.origin.cell.outPoint.txHash);
    // An origin without a block is not yet committed, so it is as fresh as an order gets.
    const mintedAt = origin?.blockNumber ?? tipNumber;
    if (mintedAt + STALE_ORDER_BLOCKS <= tipNumber) {
      stale.push(group);
    }
  }
  return stale;
}
