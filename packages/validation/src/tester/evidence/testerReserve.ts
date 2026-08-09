import type { ccc } from "@ckb-ccc/core";
import { formatCkb, postTransactionAccountPlainCkbBalance } from "@ickb/node-utils";
import type { TesterState } from "../runtime/runtime.ts";
import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  CKB_RESERVE,
  EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
  TesterTerminalError,
  type TesterScenario,
} from "../runtime/testerTypes.ts";

/**
 * Enforces the tester's plain-CKB reserve against the post-transaction account projection.
 *
 * @remarks Unlike the bot reserve policy, the tester owns a plain-cell reserve
 * invariant. Explicit CKB-spending scenarios fail terminally when they cannot
 * preserve it; other scenarios may skip instead.
 */
export function enforceTesterPlainCkbReserve(
  tx: ccc.Transaction,
  state: TesterState,
  accountLocks: ccc.Script[],
  scenario: TesterScenario,
): Record<string, string> | undefined {
  const preTxCkbBalance = state.plainCkbBalance;
  const postTxCkbBalance = postTransactionPlainCkbBalance(tx, state, accountLocks);
  if (isExplicitCkbReserveScenario(scenario) && postTxCkbBalance < CKB_RESERVE) {
    throw new TesterTerminalError(
      reserveFailureMessage(preTxCkbBalance, postTxCkbBalance),
    );
  }
  const reserveSkip = testerReserveSkip(postTxCkbBalance, preTxCkbBalance);
  if (reserveSkip === undefined) {
    return undefined;
  }
  if (postTxCkbBalance >= preTxCkbBalance) {
    return undefined;
  }
  return reserveSkip;
}

function reserveFailureMessage(
  preTxCkbBalance: bigint,
  postTxCkbBalance: bigint,
): string {
  return `Not enough CKB to preserve tester reserve after the tx: expected ${formatCkb(CKB_RESERVE)} CKB, pre-tx ${formatCkb(preTxCkbBalance)} CKB, post-tx ${formatCkb(postTxCkbBalance)} CKB`;
}

/** Projects tester plain CKB after applying a candidate transaction. */
export function postTransactionPlainCkbBalance(
  tx: ccc.Transaction,
  state: TesterState,
  accountLocks: ccc.Script[],
): bigint {
  return postTransactionAccountPlainCkbBalance(
    tx,
    state.account.capacityCells,
    accountLocks,
  );
}

/** Returns a skip payload when projected plain CKB falls below reserve. */
export function testerReserveSkip(
  postTxCkbBalance: bigint,
  preTxCkbBalance: bigint,
): Record<string, string> | undefined {
  if (postTxCkbBalance >= CKB_RESERVE) {
    return undefined;
  }
  return {
    reason: "post-tx-ckb-reserve",
    reserve: formatCkb(CKB_RESERVE),
    preTxCkbBalance: formatCkb(preTxCkbBalance),
    postTxCkbBalance: formatCkb(postTxCkbBalance),
    deficit: formatCkb(CKB_RESERVE - postTxCkbBalance),
  };
}

function isExplicitCkbReserveScenario(scenario: TesterScenario): boolean {
  return (
    scenario === ALL_CKB_LIMIT_ORDER_SCENARIO ||
    scenario === EXTRA_LARGE_LIMIT_ORDER_SCENARIO ||
    scenario === TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO ||
    scenario === MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO
  );
}
