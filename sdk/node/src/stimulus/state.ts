import type { ccc } from "@ckb-ccc/core";
import type { State } from "../../../src/conversion/types.ts";
import { isCollectable } from "../../../src/order/fill.ts";
import type { IckbSdk } from "../../../src/sdk.ts";
import { readState } from "../../../src/state.ts";
import { CKB_RESERVE } from "../shared/reserve.ts";
import type { Budgets } from "./draw.ts";

/** Runtime dependencies of one stimulus turn. */
export interface Runtime {
  client: ccc.Client;
  /** Signer over the key file's keys; signing is its only secret-bearing purpose. */
  signer: ccc.Signer;
  sdk: IckbSdk;
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
  const state = await readState(runtime.signer);
  const userOrders = [...state.availableOrders, ...state.pendingOrders];
  const live = userOrders.filter((group) => group.order.isMatchable());
  const ckbBudget = state.ckbAvailable - CKB_RESERVE;
  return {
    ...state,
    orders: {
      live: live.length,
      fulfilled: userOrders.length - live.length,
      refused: live.filter((group) => isCollectable(group, state)).length,
    },
    budgets: {
      ckb: ckbBudget > 0n ? ckbBudget : 0n,
      ickb: state.ickbAvailable,
      ratio: state.exchangeRatio,
    },
  };
}
