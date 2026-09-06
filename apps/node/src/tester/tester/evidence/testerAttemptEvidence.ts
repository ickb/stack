import type { ccc } from "@ckb-ccc/core";
import { formatCkb } from "../../../shared/index.ts";
import type { PlannedTesterAttempt } from "../planning/testerAttemptPlanning.ts";
import type { TesterState } from "../runtime/runtime.ts";
import type {
  TesterExecutionActions,
  TesterScenarioSelection,
  TesterSkip,
  TransactionShape,
} from "../runtime/testerTypes.ts";
import {
  attemptedOrderEvidence,
  testerAttemptedTransactionEvidence,
  testerExecutionActions,
  transactionShape,
} from "./testerEvidence.ts";
import { enforceTesterPlainCkbReserve } from "./testerReserve.ts";

export function testerAttemptLogFields(
  testerScenario: TesterScenarioSelection,
  state: TesterState,
  planned: PlannedTesterAttempt,
): {
  actions: TesterExecutionActions;
  transactionShape: TransactionShape;
  txFeeLog: { fee: string; feeRate: TesterState["system"]["feeRate"] };
} {
  const { built, effectiveFeePolicy, effectiveTesterScenario, estimatedOrders } = planned;
  const txFee = built.tx.estimateFee(state.system.feeRate);
  return {
    actions: testerExecutionActions({
      requestedScenario: testerScenario,
      effectiveScenario: effectiveTesterScenario,
      conversion: built.conversion,
      conversionNotice: built.conversionNotice,
      estimatedOrders,
      feePolicy: effectiveFeePolicy,
      state,
    }),
    transactionShape: transactionShape(built.tx),
    txFeeLog: { fee: formatCkb(txFee), feeRate: state.system.feeRate },
  };
}

export function testerReserveAttemptSkip(
  testerScenario: TesterScenarioSelection,
  state: TesterState,
  accountLocks: ccc.Script[],
  planned: PlannedTesterAttempt,
): TesterSkip | undefined {
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
