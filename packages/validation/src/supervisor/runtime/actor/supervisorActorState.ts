import { txCreatingHashCount } from "../shared/supervisorSummary.ts";
import type {
  BotBalanceAuditStateRead,
  Classification,
  PendingBotBalanceAudit,
  SupervisorRunState,
} from "../shared/supervisorTypes.ts";

export function recordActorClassification(
  state: SupervisorRunState,
  classification: Classification,
): Classification {
  const recorded = applyBotBalanceAudit(state, classification) ?? classification;
  const txCount = state.txCount + txCreatingHashCount(recorded);
  state.classifications.push(recorded);
  Object.assign(state, {
    txCount,
    latestPublicState: recorded.publicState ?? state.latestPublicState,
  });
  return recorded;
}

function applyBotBalanceAudit(
  state: SupervisorRunState,
  classification: Classification,
): Classification | undefined {
  for (const event of classification.botBalanceAudit?.events ?? []) {
    if (event.kind === "stateRead") {
      const failure = applyBotBalanceStateRead(
        state.pendingBotBalanceAudit,
        event,
        classification,
      );
      if (failure !== undefined) {
        return failure;
      }
      Object.assign(state, { pendingBotBalanceAudit: undefined });
      continue;
    }
    if (state.pendingBotBalanceAudit !== undefined) {
      return pendingBotBalanceAuditFailure(
        state.pendingBotBalanceAudit,
        classification,
        "bot committed transaction evidence was not followed by next-cycle balance evidence",
      );
    }
    if (!classification.terminal) {
      Object.assign(state, { pendingBotBalanceAudit: event });
    }
  }
  if (classification.terminal && state.pendingBotBalanceAudit !== undefined) {
    return pendingBotBalanceAuditFailure(
      state.pendingBotBalanceAudit,
      classification,
      "bot committed transaction evidence was not followed by next-cycle balance evidence before terminal actor stop",
    );
  }
  return undefined;
}

function applyBotBalanceStateRead(
  pending: PendingBotBalanceAudit | undefined,
  stateRead: BotBalanceAuditStateRead,
  classification: Classification,
): Classification | undefined {
  if (pending === undefined) {
    return undefined;
  }
  return stateRead.balances === undefined
    ? pendingBotBalanceAuditFailure(
        pending,
        classification,
        "bot next-cycle balance evidence was incomplete",
      )
    : undefined;
}

function pendingBotBalanceAuditFailure(
  pending: PendingBotBalanceAudit,
  classification: Classification,
  reason: string,
): Classification {
  return {
    actor: "bot",
    outcome: "malformed_evidence",
    terminal: true,
    reason,
    txHashes: pending.txHashes,
    actions: pending.actions,
    evidence: classification.evidence,
    publicState: classification.publicState,
    retryableFailures: classification.retryableFailures,
  };
}
