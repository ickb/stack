import { BOT_NO_ACTION_SKIP } from "../runtime/shared/supervisorConstants.ts";
import { boundedText } from "../runtime/shared/supervisorEvidence.ts";
import type {
  Classification,
  ClassificationBase,
  CommandResult,
  ParsedEvidence,
} from "../runtime/shared/supervisorTypes.ts";
import { preflightNonzeroOutcome } from "./supervisorPreflightStep.ts";

export function classifyPreflightResult(
  result: CommandResult,
  evidence: ParsedEvidence,
  base: ClassificationBase,
): Classification {
  if (result.status !== 0) {
    return {
      ...base,
      outcome: preflightNonzeroOutcome(result.stderr),
      terminal: true,
      reason:
        result.stderr === ""
          ? "preflight command exited nonzero"
          : boundedText(result.stderr, 240),
    };
  }
  const report = evidence.records[0];
  if (report === undefined) {
    return {
      ...base,
      outcome: "malformed_evidence",
      terminal: true,
      reason: "preflight did not return a JSON report",
    };
  }
  if (report["bounded"] !== true || report["maxIterations"] !== 1) {
    return {
      ...base,
      outcome: "malformed_evidence",
      terminal: true,
      reason: "preflight config is not bounded to one iteration",
    };
  }
  return {
    ...base,
    outcome: BOT_NO_ACTION_SKIP,
    terminal: false,
    reason: "preflight succeeded",
  };
}
