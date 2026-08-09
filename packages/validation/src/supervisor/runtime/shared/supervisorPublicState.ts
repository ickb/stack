import { BOT_DECISION_PUBLIC_STATE_EVENTS } from "./supervisorConstants.ts";
import {
  booleanField,
  numberField,
  optionalRecordField,
  recordField,
  stringField,
} from "./supervisorEvidence.ts";
import type {
  Classification,
  PublicStateAccumulator,
  PublicStateAssumption,
} from "./supervisorTypes.ts";

export function suggestedNextAction(classification: Classification): string {
  if (
    classification.outcome === "confirmation_timeout" ||
    classification.outcome === "post_broadcast_unresolved"
  ) {
    return "confirm the tx hash with a read-only chain query before sending any follow-up work";
  }
  if (classification.outcome === "low_capital_stop") {
    return "fund the supervised account or provide an alternate ignored config, then rerun a bounded smoke";
  }
  return "inspect the incident bundle and run a review pass for material code changes before extended relaunch";
}

export function latestPublicState(
  records: Array<Record<string, unknown>>,
  lastIndex = records.length - 1,
): PublicStateAssumption | undefined {
  const accumulator: PublicStateAccumulator = {
    matchDiagnosticsByIteration: new Map(),
    rebalanceByIteration: new Map(),
    ringAuditByIteration: new Map(),
  };
  for (let index = Math.min(lastIndex, records.length - 1); index >= 0; index -= 1) {
    const record = records[index];
    if (record === undefined) {
      continue;
    }
    const type = stringField(record, "type");
    const iterationId = numberField(record, "iterationId");
    collectPublicStateContext(record, type, iterationId, accumulator);
    if (type !== "bot.state.read") {
      continue;
    }
    return publicStateAssumption(record, iterationId, accumulator);
  }
  return undefined;
}

function collectPublicStateContext(
  record: Record<string, unknown>,
  type: string | undefined,
  iterationId: number | undefined,
  accumulator: PublicStateAccumulator,
): void {
  if (iterationId === undefined) {
    return;
  }
  if (BOT_DECISION_PUBLIC_STATE_EVENTS.has(type ?? "")) {
    const decision = recordField(record, "decision");
    setFirst(
      accumulator.matchDiagnosticsByIteration,
      iterationId,
      optionalRecordField(optionalRecordField(decision, "match"), "diagnostics"),
    );
    setFirst(
      accumulator.rebalanceByIteration,
      iterationId,
      optionalRecordField(decision, "rebalance"),
    );
    setFirst(
      accumulator.ringAuditByIteration,
      iterationId,
      optionalRecordField(optionalRecordField(decision, "audit"), "selectedRing"),
    );
  }
  if (type === "bot.rebalance.evaluated") {
    setFirst(
      accumulator.rebalanceByIteration,
      iterationId,
      recordField(record, "rebalance"),
    );
  }
}

function setFirst(
  map: Map<number, Record<string, unknown>>,
  key: number,
  value: Record<string, unknown> | undefined,
): void {
  if (value !== undefined && !map.has(key)) {
    map.set(key, value);
  }
}

function publicStateAssumption(
  record: Record<string, unknown>,
  iterationId: number | undefined,
  accumulator: PublicStateAccumulator,
): PublicStateAssumption {
  const orders = recordField(record, "orders");
  const poolDeposits = recordField(record, "poolDeposits");
  const latestMatchDiagnostics =
    iterationId === undefined
      ? undefined
      : accumulator.matchDiagnosticsByIteration.get(iterationId);
  const latestRebalance =
    iterationId === undefined
      ? undefined
      : accumulator.rebalanceByIteration.get(iterationId);
  const latestRingAudit =
    iterationId === undefined
      ? undefined
      : accumulator.ringAuditByIteration.get(iterationId);
  const ring = optionalRecordField(
    optionalRecordField(latestRebalance, "diagnostics"),
    "ring",
  );
  const directions = optionalRecordField(latestMatchDiagnostics, "directions");
  const ckbToUdt = optionalRecordField(directions, "ckbToUdt");
  const udtToCkb = optionalRecordField(directions, "udtToCkb");
  const candidates = optionalRecordField(latestMatchDiagnostics, "candidates");
  return {
    marketOrderCount: numberField(orders, "marketCount"),
    userOrderCount: numberField(orders, "userCount"),
    receiptCount: numberField(orders, "receiptCount"),
    ckbToUdtMatchableOrderCount: numberField(ckbToUdt, "matchableCount"),
    udtToCkbMatchableOrderCount: numberField(udtToCkb, "matchableCount"),
    viableMatchCandidateCount: numberField(candidates, "viable"),
    positiveGainMatchCandidateCount: numberField(candidates, "positiveGain"),
    rebalanceKind: stringField(latestRebalance, "kind"),
    rebalanceReason: stringField(latestRebalance, "reason"),
    poolDepositCount: numberField(poolDeposits, "totalCount"),
    readyPoolDepositCount: numberField(poolDeposits, "readyCount"),
    ringCanCreateInventory:
      booleanField(latestRingAudit, "canCreateRingInventory") ??
      booleanField(ring, "canCreateRingInventory"),
    ringTargetSegmentUdtValue:
      stringField(latestRingAudit, "targetUdtValue") ??
      stringField(ring, "targetSegmentUdtValue"),
    ringTotalPoolUdt:
      stringField(latestRingAudit, "totalPoolUdt") ?? stringField(ring, "totalPoolUdt"),
  };
}
