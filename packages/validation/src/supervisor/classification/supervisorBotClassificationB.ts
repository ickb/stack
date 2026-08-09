import {
  BOT_DEPOSIT_ONLY_COMMITTED,
  BOT_MATCH_COMMITTED,
  BOT_MATCH_PLUS_DEPOSIT_COMMITTED,
  BOT_NO_ACTION_SKIP,
  BOT_RECEIPT_COMPLETION_COMMITTED,
  BOT_STATE_READ_EVENT,
  BOT_TRANSACTION_BUILT_EVENT,
  BOT_TRANSACTION_COMMITTED_EVENT,
  BOT_WITHDRAWAL_COMPLETION_COMMITTED,
  BOT_WITHDRAWAL_REQUEST_COMMITTED,
  type OutcomeKind,
} from "../runtime/shared/supervisorConstants.ts";
import {
  bigintStringField,
  numberField,
  optionalRecordField,
  recordField,
  stringField,
} from "../runtime/shared/supervisorEvidence.ts";
import { botNoActionReason } from "../runtime/shared/supervisorSummary.ts";
import type {
  ActionCounts,
  BotBalanceAuditEvent,
  BotBalanceAuditSnapshot,
  Classification,
  ClassificationBase,
  PendingBotBalanceAudit,
  PublicStateAssumption,
  RetryableFailureSummary,
} from "../runtime/shared/supervisorTypes.ts";
import {
  actionCounts,
  extractTxHashes,
  hasValidTxHash,
} from "./supervisorClassifyUtils.ts";

interface BuiltBotCommitContext {
  base: ClassificationBase;
  botRecords: Array<Record<string, unknown>>;
  built: Record<string, unknown>;
  committed: Record<string, unknown>;
  committedIndex: number;
  publicState: PublicStateAssumption | undefined;
  retryableFailures: RetryableFailureSummary[] | undefined;
  txHashes: string[];
}

export function classifyBotCommit(
  ...[committed, committedIndex, botRecords, base, publicState, retryableFailures]: [
    committed: Record<string, unknown>,
    committedIndex: number,
    botRecords: Array<Record<string, unknown>>,
    base: ClassificationBase,
    publicState: PublicStateAssumption | undefined,
    retryableFailures: RetryableFailureSummary[] | undefined,
  ]
): Classification {
  const txHashes = extractTxHashes([committed]);
  if (txHashes === undefined) {
    return {
      ...base,
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot committed transaction evidence contained mismatched tx hashes",
      publicState,
      retryableFailures,
    };
  }
  if (!hasValidTxHash(committed)) {
    return {
      ...base,
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot committed transaction evidence did not include a valid tx hash",
      publicState,
      retryableFailures,
    };
  }
  const built = latestBotBuiltRecord(
    botRecords,
    numberField(committed, "iterationId"),
    committedIndex,
  );
  if (built === undefined) {
    return {
      ...base,
      txHashes,
      outcome: "malformed_evidence",
      terminal: true,
      reason:
        "bot committed transaction evidence did not include matching built action evidence",
      publicState,
      retryableFailures,
    };
  }
  return classifyBuiltBotCommit({
    built,
    committed,
    committedIndex,
    botRecords,
    base,
    publicState,
    retryableFailures,
    txHashes,
  });
}

function classifyBuiltBotCommit({
  base,
  botRecords,
  built,
  committed,
  committedIndex,
  publicState,
  retryableFailures,
  txHashes,
}: BuiltBotCommitContext): Classification {
  const actions = actionCounts(built["actions"]);
  if (actions === undefined) {
    return {
      ...base,
      txHashes,
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot action count evidence contained invalid count",
      publicState,
      retryableFailures,
    };
  }
  const outcome = classifyBotCommittedActions(actions);
  if (outcome === "unknown") {
    return {
      ...base,
      txHashes,
      outcome,
      terminal: true,
      reason:
        "bot committed transaction evidence did not include classifiable action evidence",
      actions,
      publicState,
      retryableFailures,
    };
  }
  const economy = validateBotCommittedEconomy(built, actions);
  if (economy !== undefined) {
    return {
      ...base,
      txHashes,
      actions,
      publicState,
      retryableFailures,
      ...economy,
    };
  }
  const balanceReview = validateBotCommittedBalanceReview({
    botRecords,
    built,
    committed,
    committedIndex,
  });
  if (balanceReview !== undefined) {
    return {
      ...base,
      txHashes,
      actions,
      publicState,
      retryableFailures,
      ...balanceReview,
    };
  }
  return botCommittedSuccessClassification({
    actions,
    base,
    outcome,
    publicState,
    retryableFailures,
    txHashes,
  });
}

function botCommittedSuccessClassification({
  actions,
  base,
  outcome,
  publicState,
  retryableFailures,
  txHashes,
}: {
  actions: ActionCounts;
  base: ClassificationBase;
  outcome: Exclude<OutcomeKind, "unknown">;
  publicState: PublicStateAssumption | undefined;
  retryableFailures: RetryableFailureSummary[] | undefined;
  txHashes: string[];
}): Classification {
  return {
    ...base,
    txHashes,
    outcome,
    terminal: false,
    reason: "bot transaction committed according to app evidence",
    actions,
    publicState,
    retryableFailures,
  };
}

export function classifyBotSkip(
  skip: Record<string, unknown> | undefined,
  base: ClassificationBase,
  publicState: PublicStateAssumption | undefined,
  retryableFailures: RetryableFailureSummary[] | undefined,
): Classification | undefined {
  if (skip === undefined) {
    return undefined;
  }
  const reason = stringField(skip, "reason") ?? "unknown";
  const txHashes = extractTxHashes([skip]);
  if (txHashes === undefined) {
    return {
      ...base,
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot skip evidence contained mismatched tx hashes",
      publicState,
      retryableFailures,
    };
  }
  const actions = actionCounts(skip["actions"]);
  if (actions === undefined) {
    return {
      ...base,
      txHashes,
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot action count evidence contained invalid count",
      publicState,
      retryableFailures,
    };
  }
  if (reason === "match_search_incomplete") {
    return {
      ...base,
      txHashes,
      outcome: "bot_terminal_error",
      terminal: true,
      reason: "bot match search incomplete; inspect decision evidence",
      actions,
      skipReason: reason,
      publicState,
      retryableFailures,
    };
  }
  if (reason === "post_tx_ckb_reserve") {
    return {
      ...base,
      txHashes,
      outcome: "bot_reserve_skip",
      terminal: false,
      reason: "bot skipped to preserve CKB reserve",
      actions,
      skipReason: reason,
      publicState,
      retryableFailures,
    };
  }
  return {
    ...base,
    txHashes,
    outcome: BOT_NO_ACTION_SKIP,
    terminal: false,
    reason: botNoActionReason(reason, publicState),
    actions,
    skipReason: reason,
    publicState,
    retryableFailures,
  };
}

export function botBalanceAuditEvents(
  records: Array<Record<string, unknown>>,
): BotBalanceAuditEvent[] {
  const events: BotBalanceAuditEvent[] = [];
  for (const [index, record] of records.entries()) {
    const type = stringField(record, "type");
    if (type === BOT_STATE_READ_EVENT) {
      events.push({
        kind: "stateRead",
        iterationId: numberField(record, "iterationId"),
        balances: balanceSnapshot(recordField(record, "balances")),
      });
      continue;
    }
    if (type === BOT_TRANSACTION_COMMITTED_EVENT) {
      const auditEvent = botCommittedBalanceAuditEvent(record, index, records);
      if (auditEvent !== undefined) {
        events.push(auditEvent);
      }
    }
  }
  return events;
}

function botCommittedBalanceAuditEvent(
  committed: Record<string, unknown>,
  committedIndex: number,
  records: Array<Record<string, unknown>>,
): PendingBotBalanceAudit | undefined {
  const txHashes = extractTxHashes([committed]);
  if (txHashes === undefined || !hasValidTxHash(committed)) {
    return undefined;
  }
  const iterationId = numberField(committed, "iterationId");
  const built = latestBotBuiltRecord(records, iterationId, committedIndex);
  if (built === undefined) {
    return undefined;
  }
  const actions = actionCounts(built["actions"]);
  if (actions === undefined) {
    return undefined;
  }
  if (classifyBotCommittedActions(actions) === "unknown") {
    return undefined;
  }
  if (validateBotCommittedEconomy(built, actions) !== undefined) {
    return undefined;
  }
  const stateBefore = latestStateReadBeforeCommit(records, committedIndex, iterationId);
  const before = balanceSnapshot(optionalRecordField(stateBefore, "balances"));
  const builtBalances = balanceSnapshot(
    optionalRecordField(recordField(built, "decision"), "balances"),
  );
  if (before === undefined || !sameBalanceSnapshot(before, builtBalances)) {
    return undefined;
  }
  return { kind: "commit", txHashes, committedIterationId: iterationId, actions };
}

/**
 * Maps committed bot action counts to the most specific supervisor outcome.
 *
 * @remarks
 * Mixed match-plus-deposit and withdrawal request outcomes have precedence over
 * simpler single-action classifications.
 */
function classifyBotCommittedActions(actions: ActionCounts): OutcomeKind {
  if (actions.matchedOrders > 0 && actions.deposits > 0) {
    return BOT_MATCH_PLUS_DEPOSIT_COMMITTED;
  }
  if (actions.withdrawalRequests > 0) {
    return BOT_WITHDRAWAL_REQUEST_COMMITTED;
  }
  if (actions.completedDeposits > 0) {
    return BOT_RECEIPT_COMPLETION_COMMITTED;
  }
  if (actions.withdrawals > 0) {
    return BOT_WITHDRAWAL_COMPLETION_COMMITTED;
  }
  if (actions.matchedOrders > 0) {
    return BOT_MATCH_COMMITTED;
  }
  if (actions.deposits > 0) {
    return BOT_DEPOSIT_ONLY_COMMITTED;
  }
  return "unknown";
}

function latestBotBuiltRecord(
  records: Array<Record<string, unknown>>,
  iterationId?: number,
  endIndex = records.length,
): Record<string, unknown> | undefined {
  for (const record of records.slice(0, endIndex).toReversed()) {
    if (
      stringField(record, "type") === BOT_TRANSACTION_BUILT_EVENT &&
      (iterationId === undefined || numberField(record, "iterationId") === iterationId)
    ) {
      return record;
    }
  }
  return undefined;
}

function validateBotCommittedBalanceReview({
  botRecords,
  built,
  committed,
  committedIndex,
}: {
  botRecords: Array<Record<string, unknown>>;
  built: Record<string, unknown>;
  committed: Record<string, unknown>;
  committedIndex: number;
}): Pick<Classification, "outcome" | "terminal" | "reason"> | undefined {
  const stateBefore = latestStateReadBeforeCommit(
    botRecords,
    committedIndex,
    numberField(committed, "iterationId"),
  );
  if (stateBefore === undefined) {
    return {
      outcome: "malformed_evidence",
      terminal: true,
      reason:
        "bot committed transaction evidence did not include previous-cycle balance evidence",
    };
  }
  if (!stateReadBalancesMatchBuiltDecision(stateBefore, built)) {
    return {
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot previous-cycle balance evidence did not match built balance evidence",
    };
  }
  return undefined;
}

function latestStateReadBeforeCommit(
  records: Array<Record<string, unknown>>,
  committedIndex: number,
  iterationId?: number,
): Record<string, unknown> | undefined {
  for (let index = committedIndex - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (
      record !== undefined &&
      stringField(record, "type") === BOT_STATE_READ_EVENT &&
      (iterationId === undefined || numberField(record, "iterationId") === iterationId)
    ) {
      return record;
    }
  }
  return undefined;
}

function stateReadBalancesMatchBuiltDecision(
  stateRead: Record<string, unknown>,
  built: Record<string, unknown>,
): boolean {
  return sameBalanceSnapshot(
    balanceSnapshot(recordField(stateRead, "balances")),
    balanceSnapshot(optionalRecordField(recordField(built, "decision"), "balances")),
  );
}

function sameBalanceSnapshot(
  left: BotBalanceAuditSnapshot | undefined,
  right: BotBalanceAuditSnapshot | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }
  return (
    left.availableCkb === right.availableCkb &&
    left.availableIckb === right.availableIckb &&
    left.unavailableCkb === right.unavailableCkb &&
    left.totalCkb === right.totalCkb
  );
}

function balanceSnapshot(
  record: Record<string, unknown> | undefined,
): BotBalanceAuditSnapshot | undefined {
  if (record === undefined) {
    return undefined;
  }
  const availableCkb = balanceField(record, "availableCkb");
  const availableIckb = balanceField(record, "availableIckb");
  const unavailableCkb = balanceField(record, "unavailableCkb");
  const totalCkb = balanceField(record, "totalCkb");
  return availableCkb === undefined ||
    availableIckb === undefined ||
    unavailableCkb === undefined ||
    totalCkb === undefined
    ? undefined
    : {
        availableCkb: availableCkb.toString(),
        availableIckb: availableIckb.toString(),
        unavailableCkb: unavailableCkb.toString(),
        totalCkb: totalCkb.toString(),
      };
}

function balanceField(
  record: Record<string, unknown>,
  field: string,
): bigint | undefined {
  return bigintStringField(record, field);
}

/**
 * Rejects economically losing match-only bot commits.
 */
function validateBotCommittedEconomy(
  built: Record<string, unknown>,
  actions: ActionCounts,
): Pick<Classification, "outcome" | "terminal" | "reason"> | undefined {
  if (!isMatchOnlyAction(actions)) {
    return undefined;
  }
  const decision = recordField(built, "decision");
  const matchValue = bigintStringField(optionalRecordField(decision, "match"), "value");
  const fee = bigintStringField(optionalRecordField(decision, "fee"), "estimated");
  const ckbScale = bigintStringField(
    optionalRecordField(decision, "exchangeRatio"),
    "ckbScale",
  );
  if (matchValue === undefined || fee === undefined || ckbScale === undefined) {
    return {
      outcome: "malformed_evidence",
      terminal: true,
      reason:
        "bot committed match-only transaction evidence did not include economic value fields",
    };
  }
  return matchValue <= fee * ckbScale
    ? {
        outcome: "economic_loss",
        terminal: true,
        reason: "bot committed match-only transaction value did not exceed tx fee",
      }
    : undefined;
}

function isMatchOnlyAction(actions: ActionCounts): boolean {
  return (
    actions.matchedOrders > 0 &&
    actions.collectedOrders === 0 &&
    actions.completedDeposits === 0 &&
    actions.deposits === 0 &&
    actions.withdrawalRequests === 0 &&
    actions.withdrawals === 0
  );
}
