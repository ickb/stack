import type { ccc } from "@ckb-ccc/core";
import { formatCkb } from "@ickb/node-utils";
import type { PlannedTesterAttempt } from "../planning/testerAttemptPlanning.ts";
import type { TesterState } from "../runtime/runtime.ts";
import type { TesterScenarioSelection } from "../runtime/testerTypes.ts";
import {
  attemptedOrderEvidence,
  enforceTesterPlainCkbReserve,
  testerAttemptedTransactionEvidence,
  testerExecutionActions,
  transactionShape,
} from "./testerEvidence.ts";

export function testerAttemptLogFields(
  testerScenario: TesterScenarioSelection,
  state: TesterState,
  planned: PlannedTesterAttempt,
): {
  actions: Record<string, unknown>;
  transactionShape: Record<string, number>;
  txFeeLog: { fee: string; feeRate: TesterState["system"]["feeRate"] };
} {
  const { built, effectiveFeePolicy, effectiveTesterScenario, estimatedOrders } = planned;
  const txFee = built.tx.estimateFee(state.system.feeRate);
  return {
    actions: testerExecutionActions(
      testerScenario,
      effectiveTesterScenario,
      built.conversion,
      built.conversionNotice,
      estimatedOrders,
      effectiveFeePolicy,
      state,
    ),
    transactionShape: transactionShape(built.tx),
    txFeeLog: { fee: formatCkb(txFee), feeRate: state.system.feeRate },
  };
}

export function testerReserveAttemptSkip(
  testerScenario: TesterScenarioSelection,
  state: TesterState,
  accountLocks: ccc.Script[],
  planned: PlannedTesterAttempt,
): Record<string, unknown> | undefined {
  const {
    built,
    effectiveFeePolicy,
    effectiveTesterScenario,
    estimatedOrders,
    rawOrders,
  } = planned;
  const reserveSkip = enforceTesterPlainCkbReserve(
    built.tx,
    state,
    accountLocks,
    effectiveTesterScenario,
  );
  if (reserveSkip === undefined) {
    return undefined;
  }
  return {
    ...reserveSkip,
    ...testerAttemptedTransactionEvidence(
      testerScenario,
      effectiveTesterScenario,
      built.conversion,
      attemptedOrderEvidence(rawOrders, estimatedOrders, effectiveFeePolicy),
    ),
  };
}
