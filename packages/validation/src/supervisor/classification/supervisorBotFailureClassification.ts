import { stringField } from "../runtime/shared/supervisorEvidence.ts";
import type {
  Classification,
  ClassificationBase,
  PublicStateAssumption,
  RetryableFailureSummary,
} from "../runtime/shared/supervisorTypes.ts";
import { extractTxHashes, hasValidTxHash } from "./supervisorClassifyUtils.ts";

export function classifyRelevantBotTransactionFailure(
  failed: Record<string, unknown> | undefined,
  base: ClassificationBase,
  publicState: PublicStateAssumption | undefined,
  retryableFailures: RetryableFailureSummary[] | undefined,
): Classification | undefined {
  if (failed === undefined) {
    return undefined;
  }
  const phase = stringField(failed, "phase");
  const postBroadcastFailure = producerPostBroadcastFailure(failed, phase);
  if (postBroadcastFailure !== undefined) {
    return classifyPostBroadcastBotTransactionFailure(
      failed,
      postBroadcastFailure,
      base,
      publicState,
      retryableFailures,
    );
  }
  if (
    phase === "broadcast" &&
    stringField(failed, "outcome") === "send_failed" &&
    failed["retryable"] === false &&
    failed["terminal"] === true
  ) {
    const txHashes = extractTxHashes([failed]);
    if (txHashes === undefined) {
      return {
        ...base,
        outcome: "malformed_evidence",
        terminal: true,
        reason:
          "bot broadcast transaction failure evidence contained mismatched tx hashes",
        publicState,
        retryableFailures,
      };
    }
    return {
      ...base,
      txHashes,
      outcome: "unknown",
      terminal: true,
      reason: "bot transaction broadcast failed",
      publicState,
      retryableFailures,
    };
  }
  return undefined;
}

function classifyPostBroadcastBotTransactionFailure(
  ...[failed, failureOutcome, base, publicState, retryableFailures]: [
    failed: Record<string, unknown>,
    failureOutcome: "timeout" | "rejected" | "unresolved",
    base: ClassificationBase,
    publicState: PublicStateAssumption | undefined,
    retryableFailures: RetryableFailureSummary[] | undefined,
  ]
): Classification {
  const txHashes = extractTxHashes([failed]);
  if (txHashes === undefined) {
    return {
      ...base,
      outcome: "malformed_evidence",
      terminal: true,
      reason:
        "bot post-broadcast transaction failure evidence contained mismatched tx hashes",
      publicState,
      retryableFailures,
    };
  }
  if (!hasValidTxHash(failed)) {
    return {
      ...base,
      outcome: "malformed_evidence",
      terminal: true,
      reason:
        "bot post-broadcast transaction failure evidence did not include a valid tx hash",
      publicState,
      retryableFailures,
    };
  }
  if (failureOutcome === "timeout") {
    return {
      ...base,
      txHashes,
      outcome: "confirmation_timeout",
      terminal: true,
      reason: "bot tx confirmation timed out",
      publicState,
      retryableFailures,
    };
  }
  if (failureOutcome === "unresolved") {
    return {
      ...base,
      txHashes,
      outcome: "post_broadcast_unresolved",
      terminal: true,
      reason: "bot tx remained unresolved after broadcast",
      publicState,
      retryableFailures,
    };
  }
  return {
    ...base,
    txHashes,
    outcome: "terminal_chain_rejection",
    terminal: true,
    reason: "bot tx reached terminal chain rejection",
    publicState,
    retryableFailures,
  };
}

function producerPostBroadcastFailure(
  failed: Record<string, unknown>,
  phase: string | undefined,
): "timeout" | "rejected" | "unresolved" | undefined {
  const outcome = stringField(failed, "outcome");
  if (phase === "confirmation" && outcome === "timeout") {
    return "timeout";
  }
  if (phase === "confirmation" && outcome === "confirmation_failed") {
    return stringField(failed, "status") === "rejected" ? "rejected" : "unresolved";
  }

  return undefined;
}
