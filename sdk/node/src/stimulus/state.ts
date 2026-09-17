import type { ccc } from "@ckb-ccc/core";
import { CKB_RESERVE } from "../../../src/constants.ts";
import { projectConversionTransactionContext } from "../../../src/conversion/sdk_projection.ts";
import type {
  AccountState,
  ConversionTransactionContext,
  SystemState,
} from "../../../src/conversion/sdk_types.ts";
import { isRefused, type OrderGroup } from "../../../src/order/index.ts";
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
  /** Fulfilled orders plus the live ones the bot will not take (see {@link abandonedOrders}): melted this turn. */
  collectable: OrderGroup[];
  /** Counts on the book before the melt; `stale` should stay zero while the bot runs. */
  orders: { live: number; fulfilled: number; refused: number; stale: number };
  budgets: Budgets;
  liquidCkb: bigint;
}

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
 * `refused` is an order the market will never fill (the SDK's rule); `stale` is any order
 * older than {@link STALE_ORDER_BLOCKS}, which a running bot should never let happen.
 */
async function abandonedOrders(
  client: ccc.Client,
  live: OrderGroup[],
  { exchangeRatio, feeRate, tip }: SystemState,
): Promise<{ refused: OrderGroup[]; stale: OrderGroup[] }> {
  const refused = live.filter((group) => isRefused(group, { exchangeRatio, feeRate }));
  // One origin read per live order, all at once: in turn they cost the turn seconds.
  const ages = await Promise.all(
    live
      .filter((group) => !refused.includes(group))
      .map(async (group) => {
        const origin = await client.getTransaction(group.origin.cell.outPoint.txHash);
        // An origin without a block is not yet committed, so it is as fresh as an order gets.
        return { group, mintedAt: origin?.blockNumber ?? tip.number };
      }),
  );
  const stale = ages
    .filter(({ mintedAt }) => mintedAt + STALE_ORDER_BLOCKS <= tip.number)
    .map(({ group }) => group);
  return { refused, stale };
}
