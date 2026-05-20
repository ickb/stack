import { type ccc } from "@ckb-ccc/core";
import {
  jsonLogReplacer,
  redactSecretText,
  writeJsonLine,
  type SecretRedactionContext,
  type SupportedChain,
} from "@ickb/node-utils";
import { type SendAndWaitForCommitEvent } from "@ickb/sdk";
import {
  type BotActions,
  type BotDecisionSkipReason,
  type BotStateSummary,
  type BuildTransactionResult,
  transactionShape,
} from "./runtime.js";

const BOT_EVENT_VERSION = 1;

export type BotEventType =
  | "bot.run.started"
  | "bot.iteration.started"
  | "bot.state.read"
  | "bot.match.evaluated"
  | "bot.rebalance.evaluated"
  | "bot.decision.skipped"
  | "bot.transaction.built"
  | "bot.transaction.sent"
  | "bot.transaction.confirmation"
  | "bot.transaction.committed"
  | "bot.transaction.failed"
  | "bot.iteration.failed";

export interface BotEventIdentity {
  version: typeof BOT_EVENT_VERSION;
  app: "bot";
  chain: SupportedChain;
  runId: string;
  iterationId: number;
  timestamp: string;
  type: BotEventType;
}

export type BotEvent = BotEventIdentity & Record<string, unknown>;

export class BotEventEmitter {
  constructor(
    private readonly context: {
      chain: SupportedChain;
      runId: string;
      write?: (event: BotEvent) => void;
    },
  ) {}

  emit(
    iterationId: number,
    type: BotEventType,
    fields: Record<string, unknown> = {},
  ): BotEvent {
    const event: BotEvent = {
      ...jsonSafeEventFields(fields),
      version: BOT_EVENT_VERSION,
      app: "bot",
      chain: this.context.chain,
      runId: this.context.runId,
      iterationId,
      timestamp: new Date().toISOString(),
      type,
    };
    (this.context.write ?? writeJsonLine)(event);
    return event;
  }
}

export function createRunId(): string {
  return `${new Date().toISOString()}-${process.pid.toString(36)}`;
}

export function emitDecisionEvents(
  emitter: BotEventEmitter,
  iterationId: number,
  result: BuildTransactionResult,
): void {
  const { decision } = result;
  emitter.emit(iterationId, "bot.match.evaluated", {
    match: decision.match,
    orders: decision.orders,
  });
  emitter.emit(iterationId, "bot.rebalance.evaluated", {
    rebalance: decision.rebalance,
    poolDeposits: decision.poolDeposits,
  });

  if (result.kind === "skipped") {
    emitter.emit(iterationId, "bot.decision.skipped", {
      reason: result.reason,
      actions: result.actions,
      decision,
    });
    return;
  }

  emitter.emit(iterationId, "bot.transaction.built", {
    actions: result.actions,
    fee: decision.fee,
    transactionShape: decision.transactionShape,
    decision,
  });
}

export function transactionSummary(
  tx: ccc.Transaction,
  fee: bigint,
  feeRate: ccc.Num,
): Record<string, unknown> {
  return {
    fee,
    feeRate,
    shape: transactionShape(tx),
  };
}

export function transactionLifecycleEvents(
  event: SendAndWaitForCommitEvent,
  secrets: SecretRedactionContext = {},
): Array<{
  type: "bot.transaction.sent" | "bot.transaction.confirmation" | "bot.transaction.committed" | "bot.transaction.failed";
  fields: Record<string, unknown>;
}> {
  switch (event.type) {
    case "broadcasted":
      return [{
        type: "bot.transaction.sent",
        fields: { txHash: event.txHash, elapsedMs: event.elapsedMs },
      }];
    case "committed":
      return [
        {
          type: "bot.transaction.confirmation",
          fields: { ...confirmationFields(event, secrets), outcome: "committed" },
        },
        {
          type: "bot.transaction.committed",
          fields: confirmationFields(event, secrets),
        },
      ];
    case "timeout_after_broadcast":
    case "post_broadcast_unresolved":
      return [
        {
          type: "bot.transaction.confirmation",
          fields: {
            ...confirmationFields(event, secrets),
            outcome: event.type,
          },
        },
        {
          type: "bot.transaction.failed",
          fields: {
            ...confirmationFields(event, secrets),
            outcome: event.type,
          },
        },
      ];
    case "terminal_rejection":
      return [
        {
          type: "bot.transaction.confirmation",
          fields: {
            ...confirmationFields(event, secrets),
            outcome: "terminal_rejection",
          },
        },
        {
          type: "bot.transaction.failed",
          fields: {
            ...confirmationFields(event, secrets),
            outcome: "terminal_rejection",
          },
        },
      ];
    case "pre_broadcast_failed":
      return [{
        type: "bot.transaction.failed",
        fields: {
          phase: "pre_broadcast",
          elapsedMs: event.elapsedMs,
          error: errorSummary(event.error, secrets),
        },
      }];
  }
}

export function lowCapitalSkipDecision(
  summary: BotStateSummary,
): {
  reason: BotDecisionSkipReason;
  actions: BotActions;
  state: BotStateSummary;
} {
  return {
    reason: "capital_below_minimum",
    actions: {
      collectedOrders: 0,
      completedDeposits: 0,
      matchedOrders: 0,
      deposits: 0,
      withdrawalRequests: 0,
      withdrawals: 0,
    },
    state: summary,
  };
}

export function errorSummary(
  error: unknown,
  secrets: SecretRedactionContext = {},
): Record<string, unknown> | string {
  return summarizeError(error, new Set<unknown>(), secrets);
}

function summarizeError(
  error: unknown,
  seen: Set<unknown>,
  secrets: SecretRedactionContext,
): Record<string, unknown> | string {
  if (error instanceof Error) {
    if (seen.has(error)) {
      return { message: "Circular error reference" };
    }
    seen.add(error);

    return {
      name: error.name,
      message: redactSecretText(error.message, secrets),
      ...(error.stack === undefined ? {} : { stack: redactSecretText(error.stack, secrets) }),
      ...("txHash" in error ? { txHash: error.txHash } : {}),
      ...("status" in error ? { status: error.status } : {}),
      ...("isTimeout" in error ? { isTimeout: error.isTimeout } : {}),
      ...("cause" in error ? { cause: summarizeError(error.cause, seen, secrets) } : {}),
    };
  }

  if (typeof error === "object" && error !== null) {
    try {
      return {
        message: "Non-Error object",
        details: JSON.parse(redactSecretText(JSON.stringify(error, jsonLogReplacer), secrets)) as unknown,
      };
    } catch {
      return { message: "Non-Error object (unserializable)" };
    }
  }

  if (typeof error === "string") {
    return redactSecretText(error, secrets);
  }

  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return error.toString();
  }

  return "Empty Error";
}

function confirmationFields(event: Extract<
  SendAndWaitForCommitEvent,
  { txHash: ccc.Hex; checks: number }
>, secrets: SecretRedactionContext = {}): Record<string, unknown> {
  return {
    txHash: event.txHash,
    status: event.status,
    checks: event.checks,
    elapsedMs: event.elapsedMs,
    ...("error" in event ? { error: errorSummary(event.error, secrets) } : {}),
  };
}

function jsonSafeEventFields(fields: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(fields, jsonLogReplacer)) as Record<string, unknown>;
}
