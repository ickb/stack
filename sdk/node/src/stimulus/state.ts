import type { ccc } from "@ckb-ccc/core";
import { CKB_RESERVE } from "../../../src/constants.ts";
import { projectConversionTransactionContext } from "../../../src/conversion/projection.ts";
import type {
  AccountState,
  ConversionTransactionContext,
  SystemState,
} from "../../../src/conversion/types.ts";
import { WALLET_LOCK_UP } from "../../../src/dao.ts";
import type { OrderGroup } from "../../../src/order/cells.ts";
import { isRefused, isStale } from "../../../src/order/fill.ts";
import type { OrderManager } from "../../../src/order/order.ts";
import type { IckbSdk } from "../../../src/sdk.ts";
import type { Budgets } from "./draw.ts";

/** Runtime dependencies of one stimulus turn. */
export interface Runtime {
  client: ccc.Client;
  /** Private-key signer; signing is its only secret-bearing purpose. */
  signer: ccc.SignerCkbPrivateKey;
  sdk: IckbSdk;
  /** The order manager, for the mint the SDK's conversion workflow does not expose. */
  order: OrderManager;
  primaryLock: ccc.Script;
  accountLocks: ccc.Script[];
}

/** Account and market state read once per turn. */
export interface StimulusState {
  system: SystemState;
  account: AccountState;
  /** Conversion context over the collectable orders only; live orders stay on the book. */
  context: ConversionTransactionContext;
  /** Fulfilled orders plus the live ones the bot will not take or left thirty days: melted this turn. */
  collectable: OrderGroup[];
  /** Counts on the book before the melt; `stale` should stay zero while the bot runs. */
  orders: { live: number; fulfilled: number; refused: number; stale: number };
  budgets: Budgets;
  liquidCkb: bigint;
}

/** Testnet hygiene, not safety: with this many own orders live, the turn stops minting. */
export const MAX_LIVE_ORDERS = 500;

export async function readStimulusState(runtime: Runtime): Promise<StimulusState> {
  const { system, user, account } = await runtime.sdk.getL1AccountState(
    runtime.client,
    runtime.accountLocks,
    WALLET_LOCK_UP,
  );
  const fulfilled = user.orders.filter((group) => group.order.isFulfilled());
  const live = user.orders.filter((group) => group.order.isMatchable());
  const { refused, stale } = abandonedOrders(live, system);
  const collectable = [...fulfilled, ...refused, ...stale];
  const { context, projection } = projectConversionTransactionContext(system, account, {
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
    liquidCkb: projection.ckbNative,
  };
}

/**
 * Live orders the bot will not take, counted apart because they mean different things:
 * `refused` is an order the market will never fill and `stale` one thirty days old (both
 * the SDK's rules); a running bot should never let a fillable order go stale.
 */
function abandonedOrders(
  live: OrderGroup[],
  { exchangeRatio, feeRate, tip }: SystemState,
): { refused: OrderGroup[]; stale: OrderGroup[] } {
  const refused = live.filter((group) => isRefused(group, { exchangeRatio, feeRate }));
  const stale = live.filter((group) => !refused.includes(group) && isStale(group, tip));
  return { refused, stale };
}
