import type { ccc } from "@ckb-ccc/core";
import { accountPlainCkbBalance } from "../../../src/conversion/account_locks.ts";
import { projectConversionTransactionContext } from "../../../src/conversion/sdk_projection.ts";
import type {
  AccountState,
  ConversionTransactionContext,
  SystemState,
} from "../../../src/conversion/sdk_types.ts";
import type { OrderGroup } from "../../../src/order/index.ts";
import type { IckbSdk } from "../../../src/sdk.ts";
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
}

const CKB = 100_000_000n;
/** Plain CKB the account keeps for its own cells and fees. */
export const CKB_RESERVE = 1000n * CKB;
/** Thirty days of eight-second blocks: an order the bot left that long is cancelled. */
export const STALE_ORDER_BLOCKS = (30n * 24n * 60n * 60n) / 8n;
/** Testnet hygiene, not safety: with this many own orders live, the turn stops minting. */
export const MAX_LIVE_ORDERS = 500;

export async function readStimulusState(runtime: Runtime): Promise<StimulusState> {
  const { system, user, account } = await runtime.sdk.getL1AccountState(
    runtime.client,
    runtime.accountLocks,
  );
  const fulfilled = user.orders.filter((group) => group.order.isFulfilled());
  const live = user.orders.filter((group) => group.order.isMatchable());
  const stale = await staleOrders(runtime.client, live, system.tip.number);
  const collectable = [...fulfilled, ...stale];
  const { context } = projectConversionTransactionContext(system, account, {
    available: collectable,
    pending: live.filter((group) => !stale.includes(group)),
  });
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
