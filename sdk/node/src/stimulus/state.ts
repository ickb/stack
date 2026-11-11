import type { ccc } from "@ckb-ccc/core";
import { projectState } from "../../../src/conversion/projection.ts";
import type { State } from "../../../src/conversion/types.ts";
import { WALLET_LOCK_UP } from "../../../src/dao.ts";
import { isCollectable } from "../../../src/order/fill.ts";
import type { IckbSdk } from "../../../src/sdk.ts";
import { CKB_RESERVE } from "../shared/reserve.ts";
import type { Budgets } from "./draw.ts";

/** Runtime dependencies of one stimulus turn. */
export interface Runtime {
  client: ccc.Client;
  /** Signer over the key file's keys; signing is its only secret-bearing purpose. */
  signer: ccc.Signer;
  sdk: IckbSdk;
  primaryLock: ccc.Script;
  accountLocks: ccc.Script[];
}

/** The state read once per turn; its `availableOrders` are melted this turn. */
export interface StimulusState extends State {
  /** Counts on the book before the melt: `refused` are live orders this turn collects. */
  orders: { live: number; fulfilled: number; refused: number };
  budgets: Budgets;
}

/** Testnet hygiene, not safety: with this many own orders live, the turn stops minting. */
export const MAX_LIVE_ORDERS = 500;

export async function readStimulusState(runtime: Runtime): Promise<StimulusState> {
  const { system, userOrders, account } = await runtime.sdk.getL1AccountState(
    runtime.client,
    runtime.accountLocks,
    WALLET_LOCK_UP,
  );
  const live = userOrders.filter((group) => group.order.isMatchable());
  const state = projectState(system, account, userOrders, runtime.primaryLock);
  const ckbBudget = state.ckbAvailable - CKB_RESERVE;
  return {
    ...state,
    orders: {
      live: live.length,
      fulfilled: userOrders.length - live.length,
      refused: live.filter((group) => isCollectable(group, system)).length,
    },
    budgets: {
      ckb: ckbBudget > 0n ? ckbBudget : 0n,
      ickb: state.ickbAvailable,
      ratio: system.exchangeRatio,
    },
  };
}
