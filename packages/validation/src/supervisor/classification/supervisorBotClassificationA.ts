import {
  BOT_DECISION_SKIPPED_EVENT,
  BOT_ITERATION_FAILED_EVENT,
  BOT_TRANSACTION_COMMITTED_EVENT,
  BOT_TRANSACTION_FAILED_EVENT,
} from "../runtime/shared/supervisorConstants.ts";
import {
  numberField,
  recordField,
  stringField,
} from "../runtime/shared/supervisorEvidence.ts";
import { latestPublicState } from "../runtime/shared/supervisorPublicState.ts";
import type {
  Classification,
  ClassificationBase,
  CommandResult,
  ParsedEvidence,
  PublicStateAssumption,
  RetryableFailureSummary,
} from "../runtime/shared/supervisorTypes.ts";
import {
  botBalanceAuditEvents,
  classifyBotCommit,
  classifyBotSkip,
} from "./supervisorBotClassificationB.ts";
import { classifyRelevantBotTransactionFailure } from "./supervisorBotFailureClassification.ts";
import {
  actionCounts,
  extractTxHashes,
  isBotRecord,
  lastRecordOfTypes,
  retryableBotFailures,
} from "./supervisorClassifyUtils.ts";

/**
 * Classifies bot evidence using operator-visible outcome precedence.
 *
 * @remarks
 * Classification starts from the latest commit, iteration-failure, or skip
 * record. Relevant transaction failures win only when they are later than that
 * outcome, or tied to its failure iteration. Retryable iteration failures are
 * non-terminal unless the event marks them terminal or later evidence proves a
 * stronger outcome.
 */
export function classifyBotResult(
  result: CommandResult,
  evidence: ParsedEvidence,
  base: ClassificationBase,
): Classification {
  const context = botClassificationContext(evidence.records);
  const iterationFailure =
    context.outcomeRecord?.type === BOT_ITERATION_FAILED_EVENT
      ? context.outcomeRecord.record
      : undefined;
  const skip =
    context.outcomeRecord?.type === BOT_DECISION_SKIPPED_EVENT
      ? context.outcomeRecord.record
      : undefined;
  const classifiers = [
    (): Classification | undefined =>
      classifyRelevantBotTransactionFailure(
        context.relevantTransactionFailure,
        base,
        context.publicState,
        context.retryableFailures,
      ),
    (): Classification | undefined =>
      classifyTerminalBotIterationFailure(
        iterationFailure,
        base,
        context.publicState,
        context.retryableFailures,
      ),
    (): Classification | undefined =>
      classifyLowCapitalBotSkip(
        skip,
        base,
        context.publicState,
        context.retryableFailures,
      ),
    (): Classification | undefined =>
      classifyNonzeroBotExit(
        result,
        evidence,
        base,
        context.publicState,
        context.retryableFailures,
      ),
    (): Classification | undefined =>
      classifyRetryableBotIterationFailure(
        iterationFailure,
        base,
        context.publicState,
        context.retryableFailures,
      ),
    (): Classification | undefined =>
      classifyBotCommitRecord(
        context.outcomeRecord,
        context.botRecords,
        base,
        context.publicState,
        context.retryableFailures,
      ),
    (): Classification | undefined =>
      classifyBotSkip(skip, base, context.publicState, context.retryableFailures),
  ];
  const classification = firstClassification(classifiers) ?? {
    ...base,
    outcome: "unknown",
    terminal: true,
    reason: "bot produced no classifiable terminal evidence",
    publicState: context.publicState,
    retryableFailures: context.retryableFailures,
  };
  return {
    ...classification,
    botBalanceAudit: { events: botBalanceAuditEvents(context.botRecords) },
  };
}

interface BotClassificationContext {
  botRecords: Array<Record<string, unknown>>;
  outcomeRecord: ReturnType<typeof lastRecordOfTypes>;
  publicState: PublicStateAssumption | undefined;
  relevantTransactionFailure: Record<string, unknown> | undefined;
  retryableFailures: RetryableFailureSummary[] | undefined;
}

function botClassificationContext(
  records: Array<Record<string, unknown>>,
): BotClassificationContext {
  const botRecords = records.filter(isBotRecord);
  const outcomeRecord = lastRecordOfTypes(botRecords, [
    BOT_TRANSACTION_COMMITTED_EVENT,
    BOT_ITERATION_FAILED_EVENT,
    BOT_DECISION_SKIPPED_EVENT,
  ]);
  return {
    botRecords,
    outcomeRecord,
    publicState: latestPublicState(botRecords, outcomeRecord?.index),
    relevantTransactionFailure: relevantBotTransactionFailure(botRecords, outcomeRecord),
    retryableFailures: retryableBotFailures(botRecords),
  };
}

function relevantBotTransactionFailure(
  botRecords: Array<Record<string, unknown>>,
  outcomeRecord: ReturnType<typeof lastRecordOfTypes>,
): Record<string, unknown> | undefined {
  const latestTransactionFailure = lastRecordOfTypes(botRecords, [
    BOT_TRANSACTION_FAILED_EVENT,
  ]);
  const latestTransactionFailureIteration = numberField(
    latestTransactionFailure?.record,
    "iterationId",
  );
  const outcomeIteration = numberField(outcomeRecord?.record, "iterationId");
  return latestTransactionFailure !== undefined &&
    (outcomeRecord === undefined ||
      latestTransactionFailure.index > outcomeRecord.index ||
      (outcomeRecord.type === BOT_ITERATION_FAILED_EVENT &&
        latestTransactionFailureIteration !== undefined &&
        latestTransactionFailureIteration === outcomeIteration))
    ? latestTransactionFailure.record
    : undefined;
}

function firstClassification(
  classifiers: Array<() => Classification | undefined>,
): Classification | undefined {
  for (const classify of classifiers) {
    const classification = classify();
    if (classification !== undefined) {
      return classification;
    }
  }
  return undefined;
}

function classifyTerminalBotIterationFailure(
  iterationFailure: Record<string, unknown> | undefined,
  base: ClassificationBase,
  publicState: PublicStateAssumption | undefined,
  retryableFailures: RetryableFailureSummary[] | undefined,
): Classification | undefined {
  if (iterationFailure?.["terminal"] !== true) {
    return undefined;
  }
  if (iterationFailure["retryable"] === true) {
    return {
      ...base,
      outcome: "bot_retryable_error",
      terminal: true,
      reason: "bot reported terminal retryable iteration failure",
      publicState,
      retryableFailures,
    };
  }
  if (iterationFailure["retryable"] !== false) {
    return undefined;
  }
  const error = recordField(iterationFailure, "error");
  const message = stringField(error, "message");
  return {
    ...base,
    outcome: "bot_terminal_error",
    terminal: true,
    reason:
      message === undefined
        ? "bot reported terminal iteration failure"
        : `bot reported terminal iteration failure: ${message}`,
    publicState,
    retryableFailures,
  };
}

function classifyLowCapitalBotSkip(
  skip: Record<string, unknown> | undefined,
  base: ClassificationBase,
  publicState: PublicStateAssumption | undefined,
  retryableFailures: RetryableFailureSummary[] | undefined,
): Classification | undefined {
  if (skip === undefined || stringField(skip, "reason") !== "capital_below_minimum") {
    return undefined;
  }
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
  return {
    ...base,
    txHashes,
    outcome: "low_capital_stop",
    terminal: true,
    reason: "bot reported capital_below_minimum",
    actions,
    skipReason: "capital_below_minimum",
    publicState,
    retryableFailures,
  };
}

function classifyNonzeroBotExit(
  ...[result, evidence, base, publicState, retryableFailures]: [
    result: CommandResult,
    evidence: ParsedEvidence,
    base: ClassificationBase,
    publicState: PublicStateAssumption | undefined,
    retryableFailures: RetryableFailureSummary[] | undefined,
  ]
): Classification | undefined {
  if (result.status === 0) {
    return undefined;
  }
  return {
    ...base,
    txHashes: extractTxHashes(evidence.records) ?? [],
    outcome: "nonzero_exit",
    terminal: true,
    reason: `bot exited with status ${String(result.status)}`,
    publicState,
    retryableFailures,
  };
}

function classifyRetryableBotIterationFailure(
  iterationFailure: Record<string, unknown> | undefined,
  base: ClassificationBase,
  publicState: PublicStateAssumption | undefined,
  retryableFailures: RetryableFailureSummary[] | undefined,
): Classification | undefined {
  if (
    iterationFailure?.["retryable"] !== true ||
    iterationFailure["terminal"] !== false
  ) {
    return undefined;
  }
  return {
    ...base,
    outcome: "bot_retryable_error",
    terminal: false,
    reason: "bot reported retryable iteration failure",
    publicState,
    retryableFailures,
  };
}

function classifyBotCommitRecord(
  ...[outcomeRecord, botRecords, base, publicState, retryableFailures]: [
    outcomeRecord:
      { type: string; record: Record<string, unknown>; index: number } | undefined,
    botRecords: Array<Record<string, unknown>>,
    base: ClassificationBase,
    publicState: PublicStateAssumption | undefined,
    retryableFailures: RetryableFailureSummary[] | undefined,
  ]
): Classification | undefined {
  return outcomeRecord?.type === BOT_TRANSACTION_COMMITTED_EVENT
    ? classifyBotCommit(
        outcomeRecord.record,
        outcomeRecord.index,
        botRecords,
        base,
        publicState,
        retryableFailures,
      )
    : undefined;
}
