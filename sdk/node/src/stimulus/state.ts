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
import { fillsWhole } from "../shared/index.ts";
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
  /** Fulfilled orders plus the live ones the bot will not take (see {@link abandonedOrders}): melted this turn. */
  collectable: OrderGroup[];
  /** Counts on the book before the melt; `stale` should stay zero while the bot runs. */
  orders: { live: number; fulfilled: number; refused: number; stale: number };
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
  const { refused, stale } = await abandonedOrders(runtime.client, live, system);
  const collectable = [...fulfilled, ...refused, ...stale];
  const { context } = projectConversionTransactionContext(system, account, {
    available: collectable,
    pending: live.filter((group) => !collectable.includes(group)),
  });
  const ckbBudget = context.ckbAvailable - CKB_RESERVE;
  return {
    system,
    account,
    context,
    collectable,
    orders: {
      live: live.length,
      fulfilled: fulfilled.length,
      refused: refused.length,
      stale: stale.length,
    },
    budgets: {
      ckb: ckbBudget > 0n ? ckbBudget : 0n,
      ickb: context.ickbAvailable,
      ratio: system.exchangeRatio,
    },
    plainCkb: accountPlainCkbBalance(account.capacityCells, runtime.accountLocks),
  };
}

/**
 * Live orders the bot will not take, counted apart because they mean different things:
 * `refused` is a buy the bot's own matcher would not fill whole today, which the DAO
 * ratio's growth only pushes further from filling; `stale` is any order older than
 * {@link STALE_ORDER_BLOCKS}, which a running bot should never let happen. A sell is never
 * refused, since the same growth only raises what the bot earns on it, so a sell the bot
 * does not take yet may still be taken later (decisions amendment 52).
 */
async function abandonedOrders(
  client: ccc.Client,
  live: OrderGroup[],
  { exchangeRatio, feeRate, tip }: SystemState,
): Promise<{ refused: OrderGroup[]; stale: OrderGroup[] }> {
  const refused: OrderGroup[] = [];
  const stale: OrderGroup[] = [];
  for (const group of live) {
    const { info } = group.order.data;
    if (info.isCkb2Udt() && !fillsWhole(group, true, exchangeRatio, feeRate)) {
      refused.push(group);
      continue;
    }
    const origin = await client.getTransaction(group.origin.cell.outPoint.txHash);
    // An origin without a block is not yet committed, so it is as fresh as an order gets.
    const mintedAt = origin?.blockNumber ?? tip.number;
    if (mintedAt + STALE_ORDER_BLOCKS <= tip.number) {
      stale.push(group);
    }
  }
  return { refused, stale };
}
