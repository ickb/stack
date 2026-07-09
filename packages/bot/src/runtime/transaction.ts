import { ccc } from "@ckb-ccc/core";
import { receiptPhase2Capacity } from "@ickb/core";
import { OrderManager, type Match } from "@ickb/order";
import { planRebalance } from "../policy.ts";
import { auditSummary } from "./audit.ts";
import { buildDecisionTranscript } from "./decision.ts";
import {
  actionsForState,
  actionTotal,
  DIRECT_DEPOSIT_FEE_HEADROOM,
  emptyActions,
  isMatchOnly,
  MATCH_STEP_DIVISOR,
  matchableCkb,
  MAX_OUTPUTS_BEFORE_CHANGE,
  maxBigInt,
  usefulMatchFloors,
} from "./support.ts";
import type {
  BotActions,
  BotDecisionTranscript,
  BotState,
  BuildTransactionResult,
  BuildTransactionSkipReason,
  CandidateTransaction,
  Runtime,
} from "./types.ts";

type CompletedDecisionTranscript = BotDecisionTranscript & {
  fee: BotDecisionTranscript["fee"] & { estimated: bigint };
};

/**
 * Plans the bot transaction for the current state, then applies fee and reserve gates.
 *
 * @remarks Matching is evaluated before rebalancing. Rebalance planning receives
 * only the output slots left by the match candidate so the final transaction has
 * room for fee/change completion.
 */
export async function buildTransaction(
  runtime: Runtime,
  state: BotState,
): Promise<BuildTransactionResult> {
  const { match, candidate, outputSlots } = await prepareCandidateTransaction(
    runtime,
    state,
  );
  const actionCount = actionTotal(candidate.actions);
  if (actionCount === 0) {
    return skippedResult(
      "no_actions",
      candidate.actions,
      decisionForCandidate({ runtime, state, match, candidate, outputSlots }),
    );
  }
  if (candidate.tx.outputs.length > MAX_OUTPUTS_BEFORE_CHANGE) {
    return skippedResult(
      "output_limit",
      emptyActions(),
      {
        ...decisionForCandidate({ runtime, state, match, candidate, outputSlots }),
        actions: emptyActions(),
      },
      {
        attemptedActions: candidate.actions,
      },
    );
  }

  const { tx, decision } = await completeCandidateTransaction({
    runtime,
    state,
    match,
    candidate,
    outputSlots,
  });
  const reserveCheck = decision.audit.reserveCheck;
  if (
    !reserveCheck.recoveryException &&
    reserveCheck.projectedPostTransactionCkb < reserveCheck.reserve
  ) {
    return skippedResult(
      "post_tx_ckb_reserve",
      emptyActions(),
      {
        ...decision,
        actions: emptyActions(),
      },
      {
        attemptedActions: candidate.actions,
      },
    );
  }

  if (isMatchOnly(candidate.actions)) {
    return matchOnlyResult({
      state,
      match,
      fee: decision.fee.estimated,
      candidate,
      decision,
      tx,
    });
  }

  return { kind: "built", tx, actions: candidate.actions, decision };
}

async function prepareCandidateTransaction(
  runtime: Runtime,
  state: BotState,
): Promise<{ match: Match; candidate: CandidateTransaction; outputSlots: number }> {
  // Match allowance scales with current deposit capacity, which keeps small
  // partial matches from consuming output slots without meaningful inventory gain.
  const ckbAllowanceStep = maxBigInt(1n, state.depositCapacity / MATCH_STEP_DIVISOR);
  const match = OrderManager.bestMatch(
    state.marketOrders,
    {
      ckbValue: matchableCkb(state.availableCkbBalance),
      udtValue: state.availableIckbBalance,
    },
    state.system.exchangeRatio,
    {
      feeRate: state.system.feeRate,
      ckbAllowanceStep,
      maxPartials: MAX_OUTPUTS_BEFORE_CHANGE,
    },
  );
  const usefulFloors = usefulMatchFloors(match.diagnostics);
  let tx = ccc.Transaction.default();
  if (match.partials.length > 0) {
    tx = runtime.managers.order.addMatch(tx, match);
  }

  const outputSlots = Math.max(0, MAX_OUTPUTS_BEFORE_CHANGE - tx.outputs.length);
  const rebalance = planRebalance({
    outputSlots,
    tip: state.system.tip,
    ickbBalance: state.availableIckbBalance + match.udtDelta,
    ckbBalance: state.availableCkbBalance + match.ckbDelta,
    directDepositCapacity:
      state.depositCapacity + receiptPhase2Capacity(runtime.primaryLock),
    directDepositFeeHeadroom: DIRECT_DEPOSIT_FEE_HEADROOM,
    ickbRefillThreshold: usefulFloors.ickb,
    ckbRecoveryThreshold: reserveRecoveryThreshold(usefulFloors.ckb),
    poolDeposits: state.poolDeposits,
    readyDeposits: state.readyPoolDeposits,
  });
  const candidate = await buildCandidateTransaction({
    runtime,
    state,
    match,
    rebalance,
    tx,
  });
  return { match, candidate, outputSlots };
}

async function completeCandidateTransaction({
  runtime,
  state,
  match,
  candidate,
  outputSlots,
}: {
  runtime: Runtime;
  state: BotState;
  match: Match;
  candidate: CandidateTransaction;
  outputSlots: number;
}): Promise<{
  tx: ccc.Transaction;
  decision: CompletedDecisionTranscript;
}> {
  const tx = await runtime.sdk.completeTransaction(candidate.tx, {
    signer: runtime.signer,
    client: runtime.client,
    feeRate: state.system.feeRate,
  });
  const fee = tx.estimateFee(state.system.feeRate);
  const audit = auditSummary({
    runtime,
    state,
    match,
    rebalance: candidate.rebalance,
    fee,
  });
  const decision = buildDecisionTranscript({
    runtime,
    state,
    match,
    rebalance: candidate.rebalance,
    outputSlots,
    actions: candidate.actions,
    tx,
  });
  return {
    tx,
    decision: { ...decision, audit, fee: { ...decision.fee, estimated: fee } },
  };
}

function matchOnlyResult({
  state,
  match,
  fee,
  candidate,
  decision,
  tx,
}: {
  state: BotState;
  match: Match;
  fee: bigint;
  candidate: CandidateTransaction;
  decision: BotDecisionTranscript;
  tx: ccc.Transaction;
}): BuildTransactionResult {
  const matchValue =
    match.ckbDelta * state.system.exchangeRatio.ckbScale +
    match.udtDelta * state.system.exchangeRatio.udtScale;
  const valuedDecision = {
    ...decision,
    match: { ...decision.match, value: matchValue },
  };
  // Pure matches must beat the fee because no collection or rebalance action
  // justifies sending an otherwise value-neutral transaction.
  if (matchValue <= fee * state.system.exchangeRatio.ckbScale) {
    return skippedResult(
      "match_value_not_above_fee",
      emptyActions(),
      {
        ...valuedDecision,
        actions: emptyActions(),
      },
      {
        fee,
        matchValue,
        attemptedActions: candidate.actions,
      },
    );
  }
  return {
    kind: "built",
    tx,
    actions: candidate.actions,
    decision: valuedDecision,
  };
}

async function buildCandidateTransaction({
  runtime,
  state,
  match,
  rebalance,
  tx: matchTx,
}: {
  runtime: Runtime;
  state: BotState;
  match: Match;
  rebalance: CandidateTransaction["rebalance"];
  tx: ccc.Transaction;
}): Promise<CandidateTransaction> {
  let tx = await runtime.sdk.buildBaseTransaction(matchTx, runtime.client, {
    withdrawalRequest:
      rebalance.kind === "withdraw"
        ? {
            deposits: rebalance.deposits,
            requiredLiveDeposits: rebalance.requiredLiveDeposits,
            lock: runtime.primaryLock,
          }
        : undefined,
    orders: state.userOrders,
    receipts: state.receipts,
    readyWithdrawals: state.readyWithdrawals,
  });
  if (rebalance.kind === "deposit") {
    tx = await runtime.managers.logic.deposit(
      tx,
      rebalance.quantity,
      state.depositCapacity,
      runtime.primaryLock,
      runtime.client,
    );
  }

  const actions = actionsForState(state, match, rebalance);
  return {
    tx,
    actions,
    rebalance,
  };
}

function decisionForCandidate({
  runtime,
  state,
  match,
  candidate,
  outputSlots,
}: {
  runtime: Runtime;
  state: BotState;
  match: Match;
  candidate: CandidateTransaction;
  outputSlots: number;
}): BotDecisionTranscript {
  return buildDecisionTranscript({
    runtime,
    state,
    match,
    rebalance: candidate.rebalance,
    outputSlots,
    actions: candidate.actions,
    tx: candidate.tx,
  });
}

function reserveRecoveryThreshold(usefulCkbFloor: bigint): bigint {
  return maxBigInt(0n, usefulCkbFloor) + 1000n * ccc.fixedPointFrom(1);
}

function skippedResult(
  reason: BuildTransactionSkipReason,
  actions: BotActions,
  decision: BotDecisionTranscript,
  details?: {
    fee?: bigint;
    matchValue?: bigint;
    attemptedActions?: BotActions;
  },
): BuildTransactionResult {
  return {
    kind: "skipped",
    reason,
    actions,
    decision: {
      ...decision,
      skip: {
        reason,
        ...details,
      },
    },
  };
}
