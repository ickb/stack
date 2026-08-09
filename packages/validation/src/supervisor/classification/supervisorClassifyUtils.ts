import { minimalProcessEnv } from "@ickb/node-utils";
import process from "node:process";
import {
  BOT_ITERATION_FAILED_EVENT,
  BOT_TRANSACTION_FAILED_EVENT,
  TX_HASH_PATTERN,
} from "../runtime/shared/supervisorConstants.ts";
import {
  isNonNegativeSafeInteger,
  isOutputIndex,
  isRecord,
  numberField,
  optionalRecordField,
  recordField,
  stringField,
} from "../runtime/shared/supervisorEvidence.ts";
import type {
  ActionCounts,
  Classification,
  RetryableFailureSummary,
} from "../runtime/shared/supervisorTypes.ts";

export function actionCounts(value: unknown): ActionCounts | undefined {
  const record = isRecord(value) ? value : {};
  const collectedOrders = actionCountField(record, "collectedOrders");
  const completedDeposits = actionCountField(record, "completedDeposits");
  const matchedOrders = actionCountField(record, "matchedOrders");
  const deposits = actionCountField(record, "deposits");
  const withdrawalRequests = actionCountField(record, "withdrawalRequests");
  const withdrawals = actionCountField(record, "withdrawals");
  if (
    collectedOrders === undefined ||
    completedDeposits === undefined ||
    matchedOrders === undefined ||
    deposits === undefined ||
    withdrawalRequests === undefined ||
    withdrawals === undefined
  ) {
    return undefined;
  }
  return {
    collectedOrders,
    completedDeposits,
    matchedOrders,
    deposits,
    withdrawalRequests,
    withdrawals,
  };
}

function actionCountField(
  record: Record<string, unknown>,
  key: keyof ActionCounts,
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return 0;
  }
  return isNonNegativeSafeInteger(value) ? value : undefined;
}

export function emptyActions(): ActionCounts {
  return {
    collectedOrders: 0,
    completedDeposits: 0,
    matchedOrders: 0,
    deposits: 0,
    withdrawalRequests: 0,
    withdrawals: 0,
  };
}

export function classifyTesterTransactionFailure(
  value: unknown,
  record: Record<string, unknown>,
): Pick<Classification, "outcome" | "terminal" | "reason" | "txHashes"> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (stringField(value, "name") !== "TransactionConfirmationError") {
    return undefined;
  }
  const txHashes = extractTxHashes([record]);
  if (txHashes === undefined) {
    return {
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester transaction failure evidence contained mismatched tx hashes",
      txHashes: [],
    };
  }
  if (txHashes.length === 0) {
    return {
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester transaction failure evidence did not include a valid tx hash",
      txHashes: [],
    };
  }
  if (value["isTimeout"] === false) {
    return {
      outcome: "terminal_chain_rejection",
      terminal: true,
      reason: "tester tx reached terminal chain rejection",
      txHashes,
    };
  }
  if (value["isTimeout"] === true && "cause" in value) {
    return {
      outcome: "post_broadcast_unresolved",
      terminal: true,
      reason: "tester tx remained unresolved after broadcast",
      txHashes,
    };
  }
  return {
    outcome: "confirmation_timeout",
    terminal: true,
    reason: "tester transaction confirmation timed out",
    txHashes,
  };
}

export function extractTxHashes(
  records: Array<Record<string, unknown>>,
): string[] | undefined {
  const hashes = new Set<string>();
  for (const record of records) {
    const recordHashes = validTxHashes([
      stringField(record, "txHash"),
      stringField(recordField(record, "error"), "txHash"),
      stringField(recordField(record, "skip"), "txHash"),
    ]);
    if (recordHashes.length > 1) {
      return undefined;
    }
    for (const hash of recordHashes) {
      hashes.add(hash);
    }
  }
  return [...hashes];
}

function validTxHashes(values: unknown[]): string[] {
  const hashes = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && TX_HASH_PATTERN.test(value)) {
      hashes.add(value);
    }
  }
  return [...hashes];
}

export function hasValidTxHash(
  record: Record<string, unknown>,
): record is Record<string, unknown> & { txHash: string } {
  const txHash = record["txHash"];
  return typeof txHash === "string" && TX_HASH_PATTERN.test(txHash);
}

export function liveActorEnv(extra: Record<string, string>): Record<string, string> {
  return {
    ...minimalProcessEnv(process.env),
    ...extra,
  };
}

export function isTesterFundingError(value: unknown): boolean {
  const record = isRecord(value) ? value : undefined;
  const message = typeof value === "string" ? value : stringField(record, "message");
  return message !== undefined && /Not enough (?:funds|CKB|iCKB)/u.test(message);
}

export function isBotRecord(record: Record<string, unknown>): boolean {
  return record["app"] === "bot";
}

export function retryableBotFailures(
  records: Array<Record<string, unknown>>,
): RetryableFailureSummary[] | undefined {
  const failures = records.flatMap((record): RetryableFailureSummary[] => {
    const type = stringField(record, "type");
    if (
      (type !== BOT_TRANSACTION_FAILED_EVENT && type !== BOT_ITERATION_FAILED_EVENT) ||
      record["retryable"] !== true ||
      record["terminal"] !== false
    ) {
      return [];
    }
    const error = recordField(record, "error");
    return [
      {
        actor: "bot",
        type,
        iterationId: numberField(record, "iterationId"),
        phase: stringField(record, "phase"),
        outcome: stringField(record, "outcome"),
        errorName: stringField(error, "name"),
        errorCode: numberField(error, "code"),
        currentFee: stringField(error, "currentFee"),
        leastFee: stringField(error, "leastFee"),
        outPoint: outPointSummary(error),
      },
    ];
  });
  return failures.length === 0 ? undefined : failures;
}

function outPointSummary(
  record: Record<string, unknown> | undefined,
): RetryableFailureSummary["outPoint"] | undefined {
  const outPoint = optionalRecordField(record, "outPoint");
  if (outPoint === undefined) {
    return undefined;
  }
  const txHash = stringField(outPoint, "txHash");
  const index = stringField(outPoint, "index");
  return txHash !== undefined && TX_HASH_PATTERN.test(txHash) && isOutputIndex(index)
    ? { txHash, index }
    : undefined;
}

export function lastRecordOfTypes(
  records: Array<Record<string, unknown>>,
  types: readonly string[],
): { type: string; record: Record<string, unknown>; index: number } | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record === undefined) {
      continue;
    }
    const type = stringField(record, "type");
    if (type !== undefined && types.includes(type)) {
      return { type, record, index };
    }
  }
  return undefined;
}
