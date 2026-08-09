import {
  classifyTesterTransactionFailure,
  extractTxHashes,
  hasValidTxHash,
  isBotRecord,
  isTesterFundingError,
} from "../classification/supervisorClassifyUtils.ts";
import {
  TESTER_CONVERSION_CREATED,
  TESTER_FRESH_ORDER_SKIP,
  TESTER_ORDER_CREATED,
  TESTER_SAMPLED_TOO_SMALL_SKIP,
} from "../runtime/shared/supervisorConstants.ts";
import {
  booleanField,
  isRecord,
  recordField,
  stringField,
} from "../runtime/shared/supervisorEvidence.ts";
import type {
  Classification,
  ClassificationBase,
  CommandResult,
  ParsedEvidence,
  TesterEvidenceExpectation,
} from "../runtime/shared/supervisorTypes.ts";
import {
  testerOrderEvidence,
  validateTesterEvidenceExpectation,
} from "./supervisorTesterEvidence.ts";

const FRESH_ORDER_SKIP_REASONS = new Set([
  "fresh-matchable-order",
  "matchable-order-transaction-missing",
]);

export function classifyTesterResult(
  result: CommandResult,
  evidence: ParsedEvidence,
  base: ClassificationBase,
  expectation?: TesterEvidenceExpectation,
): Classification {
  const testerLogs = evidence.records.filter((record) => !isBotRecord(record));
  const latest = testerLogs.at(-1);
  const errorClassification = classifyTesterError(latest, base);
  if (
    errorClassification !== undefined &&
    errorClassification.outcome !== "tester_retryable_error"
  ) {
    return errorClassification;
  }
  if (result.status !== 0) {
    return {
      ...base,
      txHashes: extractTxHashes(evidence.records) ?? [],
      outcome: "nonzero_exit",
      terminal: true,
      reason: `tester exited with status ${String(result.status)}`,
    };
  }
  if (errorClassification !== undefined) {
    return errorClassification;
  }
  const skipClassification = classifyTesterSkip(latest, base);
  if (skipClassification !== undefined) {
    return skipClassification;
  }
  const commitClassification = classifyTesterCommit(latest, base, expectation);
  if (commitClassification !== undefined) {
    return commitClassification;
  }
  return {
    ...base,
    outcome: "unknown",
    terminal: true,
    reason: "tester produced no classifiable terminal evidence",
  };
}

function classifyTesterError(
  latest: Record<string, unknown> | undefined,
  base: ClassificationBase,
): Classification | undefined {
  if (latest === undefined) {
    return undefined;
  }
  const error = latest["error"];
  if (error === undefined) {
    return undefined;
  }
  const transactionFailure = classifyTesterTransactionFailure(error, latest);
  if (transactionFailure !== undefined) {
    return { ...base, ...transactionFailure };
  }
  if (isTesterFundingError(error)) {
    return {
      ...base,
      outcome: "low_capital_stop",
      terminal: true,
      reason: "tester reported insufficient funds",
    };
  }
  if (isRecord(error) && booleanField(error, "retryable") === true) {
    const terminal = booleanField(error, "terminal") === true;
    return {
      ...base,
      outcome: "tester_retryable_error",
      terminal,
      reason: terminal
        ? "tester reported terminal retryable iteration failure"
        : "tester reported retryable iteration failure",
    };
  }
  return {
    ...base,
    outcome: "tester_deterministic_pre_broadcast_error",
    terminal: true,
    reason: "tester recorded an error before a committed transaction was proven",
  };
}

/**
 * Classifies tester skip evidence into non-terminal operator outcomes when known.
 */
function classifyTesterSkip(
  latest: Record<string, unknown> | undefined,
  base: ClassificationBase,
): Classification | undefined {
  if (latest === undefined) {
    return undefined;
  }
  const skip = recordField(latest, "skip");
  if (skip === undefined) {
    return undefined;
  }
  const reason = stringField(skip, "reason") ?? "unknown";
  const txHashResult = testerSkipTxHashes(latest, reason, base);
  if ("classification" in txHashResult) {
    return txHashResult.classification;
  }
  const { txHashes } = txHashResult;
  if (reason === "fresh-matchable-order") {
    return {
      ...base,
      txHashes,
      outcome: TESTER_FRESH_ORDER_SKIP,
      terminal: false,
      reason: "tester skipped fresh matchable order",
      skipReason: reason,
    };
  }
  if (reason === "matchable-order-transaction-missing") {
    return {
      ...base,
      txHashes,
      outcome: TESTER_FRESH_ORDER_SKIP,
      terminal: false,
      reason: "tester skipped because matchable order transaction was not readable yet",
      skipReason: reason,
    };
  }
  if (reason === "sampled-amount-too-small") {
    return {
      ...base,
      txHashes,
      outcome: TESTER_SAMPLED_TOO_SMALL_SKIP,
      terminal: false,
      reason: "tester sampled amount too small",
      skipReason: reason,
    };
  }
  if (reason === "estimated-conversion-too-small") {
    return {
      ...base,
      txHashes,
      outcome: "tester_estimated_too_small_skip",
      terminal: false,
      reason: "tester estimate converted amount too small",
      skipReason: reason,
    };
  }
  if (reason === "post-tx-ckb-reserve") {
    return {
      ...base,
      txHashes,
      outcome: "tester_reserve_skip",
      terminal: false,
      reason: "tester skipped to preserve CKB reserve",
      skipReason: reason,
    };
  }
  return {
    ...base,
    txHashes,
    outcome: "unknown",
    terminal: true,
    reason: `tester skip reason is not classified: ${reason}`,
    skipReason: reason,
  };
}

function testerSkipTxHashes(
  latest: Record<string, unknown>,
  reason: string,
  base: ClassificationBase,
): { classification: Classification } | { txHashes: string[] } {
  const txHashes = extractTxHashes([latest]);
  if (txHashes === undefined) {
    return {
      classification: {
        ...base,
        outcome: "malformed_evidence",
        terminal: true,
        reason: "tester skip evidence contained mismatched tx hashes",
      },
    };
  }
  if (!FRESH_ORDER_SKIP_REASONS.has(reason) || txHashes.length === 1) {
    return { txHashes };
  }
  return {
    classification: {
      ...base,
      txHashes,
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester fresh-order skip evidence did not include one valid tx hash",
    },
  };
}

function classifyTesterCommit(
  latest: Record<string, unknown> | undefined,
  base: ClassificationBase,
  expectation?: TesterEvidenceExpectation,
): Classification | undefined {
  if (latest === undefined || !("txHash" in latest)) {
    return undefined;
  }
  if (!hasValidTxHash(latest)) {
    return {
      ...base,
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester committed transaction evidence did not include a valid tx hash",
    };
  }
  const txHashes = [latest.txHash];
  const actions = recordField(latest, "actions");
  const expectationFailure = validateTesterEvidenceExpectation(actions, expectation);
  if (expectationFailure !== undefined) {
    return {
      ...base,
      txHashes,
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason: expectationFailure,
    };
  }
  return classifyTesterCommitActions(actions, txHashes, base);
}

/**
 * Classifies tester committed action evidence with conversion and dust precedence.
 */
function classifyTesterCommitActions(
  actions: Record<string, unknown> | undefined,
  txHashes: string[],
  base: ClassificationBase,
): Classification {
  const testerOrder = testerOrderEvidence(actions);
  const conversionKind = stringField(recordField(actions ?? {}, "conversion"), "kind");
  if (testerOrder === undefined && conversionKind === undefined) {
    return {
      ...base,
      txHashes,
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester committed transaction evidence did not include action evidence",
    };
  }
  if (conversionKind !== undefined) {
    return {
      ...base,
      txHashes,
      outcome: TESTER_CONVERSION_CREATED,
      terminal: false,
      reason: "tester created a direct conversion transaction",
      ...(testerOrder === undefined ? {} : { testerOrder }),
    };
  }
  const dustOrder =
    testerOrder !== undefined &&
    testerOrder.orders.length > 0 &&
    testerOrder.orders.every((order) => order.dust);
  if (dustOrder) {
    return {
      ...base,
      txHashes,
      outcome: "tester_dust_order_created",
      terminal: false,
      reason: "tester created only dust order stimulus",
      testerOrder,
    };
  }
  return {
    ...base,
    txHashes,
    outcome: TESTER_ORDER_CREATED,
    terminal: false,
    reason: "tester created an order transaction",
    testerOrder,
  };
}
