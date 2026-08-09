import { classifyPreflightResult } from "../preflight/supervisorPreflightClassification.ts";
import type { Actor } from "../runtime/shared/supervisorConstants.ts";
import {
  parseJsonEvidence,
  parsePreflightEvidence,
} from "../runtime/shared/supervisorEvidence.ts";
import type {
  Classification,
  ClassificationBase,
  CommandResult,
  ParsedEvidence,
  TesterEvidenceExpectation,
} from "../runtime/shared/supervisorTypes.ts";
import { classifyTesterResult } from "../tester/supervisorTesterClassification.ts";
import { classifyBotResult } from "./supervisorBotClassificationA.ts";
import { botBalanceAuditEvents } from "./supervisorBotClassificationB.ts";
import { extractTxHashes, isBotRecord } from "./supervisorClassifyUtils.ts";

/**
 * Applies infrastructure checks before actor-specific outcome classification.
 *
 * @remarks
 * This precedence keeps timeouts, spawn failures, truncated output, and malformed
 * evidence terminal before bot/tester/preflight policy classifiers inspect the
 * accepted records.
 */
export function classifyActorResult(
  actor: Actor | "preflight",
  result: CommandResult,
  expectation?: TesterEvidenceExpectation,
): Classification {
  const evidence = (actor === "preflight" ? parsePreflightEvidence : parseJsonEvidence)(
    result.stdout,
  );
  const base = {
    actor,
    txHashes: [],
    evidence: {
      recordsAccepted: evidence.records.length,
      ignoredLineCount: evidence.ignoredLines.length,
      malformedLineCount: evidence.malformedLines.length,
      exitStatus: result.status,
      signal: result.signal,
      timedOut: result.timedOut,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    },
  };
  const genericBase = {
    ...base,
    txHashes: extractTxHashes(evidence.records) ?? [],
  };
  const infrastructureFailure = classifyInfrastructureFailure(
    result,
    actor,
    evidence,
    genericBase,
  );
  if (infrastructureFailure !== undefined) {
    return actor === "bot"
      ? {
          ...infrastructureFailure,
          botBalanceAudit: {
            events: botBalanceAuditEvents(evidence.records.filter(isBotRecord)),
          },
        }
      : infrastructureFailure;
  }
  if (actor === "preflight") {
    return classifyPreflightResult(result, evidence, base);
  }
  if (actor === "bot") {
    return classifyBotResult(result, evidence, base);
  }
  return classifyTesterResult(result, evidence, base, expectation);
}

function classifyInfrastructureFailure(
  result: CommandResult,
  actor: Actor | "preflight",
  evidence: ParsedEvidence,
  genericBase: ClassificationBase,
): Classification | undefined {
  if (result.timedOut) {
    return {
      ...genericBase,
      outcome: "command_timeout",
      terminal: true,
      reason: "supervisor command timeout expired",
    };
  }
  if (result.spawnError !== undefined) {
    return {
      ...genericBase,
      outcome: "nonzero_exit",
      terminal: true,
      reason: `${actor} failed to spawn: ${result.spawnError}`,
    };
  }
  if (result.stdoutTruncated || result.stderrTruncated) {
    return {
      ...genericBase,
      outcome: "malformed_evidence",
      terminal: true,
      reason: result.stdoutTruncated
        ? "stdout evidence exceeded supervisor capture limit"
        : "stderr evidence exceeded supervisor capture limit",
    };
  }
  if (evidence.malformedLines.length > 0) {
    return {
      ...genericBase,
      outcome: "malformed_evidence",
      terminal: true,
      reason: "stdout contained malformed JSON evidence",
    };
  }
  return undefined;
}
