import { type ccc } from "@ckb-ccc/core";
import {
  isRetryableCkbStateRaceError,
  isRetryableRpcTransportError,
  jsonLogReplacer,
  writeJsonLine,
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
  | "bot.chain.preflight"
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
): Array<{
  type: "bot.transaction.sent" | "bot.transaction.confirmation" | "bot.transaction.committed" | "bot.transaction.failed";
  fields: Record<string, unknown>;
}> {
  switch (event.type) {
    case "broadcasted":
      return [{
        type: "bot.transaction.sent",
        fields: {
          txHash: event.txHash,
          phase: "broadcast",
          outcome: "broadcasted",
          elapsedMs: event.elapsedMs,
        },
      }];
    case "committed":
      return [
        {
          type: "bot.transaction.confirmation",
          fields: {
            ...confirmationFields(event),
            outcome: "committed",
            retryable: false,
            terminal: true,
          },
        },
        {
          type: "bot.transaction.committed",
          fields: { ...confirmationFields(event), outcome: "committed" },
        },
      ];
    case "timeout_after_broadcast":
    case "post_broadcast_unresolved":
      return [
        {
          type: "bot.transaction.confirmation",
          fields: {
            ...confirmationFields(event),
            outcome: event.type,
            retryable: false,
            terminal: true,
          },
        },
        {
          type: "bot.transaction.failed",
          fields: {
            ...confirmationFields(event),
            outcome: event.type,
            retryable: false,
            terminal: true,
          },
        },
      ];
    case "terminal_rejection":
      return [
        {
          type: "bot.transaction.confirmation",
          fields: {
            ...confirmationFields(event),
            outcome: "terminal_rejection",
            retryable: false,
            terminal: true,
          },
        },
        {
          type: "bot.transaction.failed",
          fields: {
            ...confirmationFields(event),
            outcome: "terminal_rejection",
            retryable: false,
            terminal: true,
          },
        },
      ];
    case "pre_broadcast_failed":
      {
        const retryable = isRetryableRpcTransportError(event.error) ||
          isRetryableCkbStateRaceError(event.error);
        return [{
          type: "bot.transaction.failed",
          fields: {
            phase: "pre_broadcast",
            outcome: "pre_broadcast_failed",
            elapsedMs: event.elapsedMs,
            error: errorSummary(event.error, { includeStack: !retryable }),
            retryable,
            terminal: !retryable,
          },
        }];
      }
  }
}

export function lowCapitalSkipDecision(
  summary: BotStateSummary,
): {
  reason: BotDecisionSkipReason;
  actions: BotActions;
  state: BotStateSummary;
  deficit: bigint;
} {
  const deficit = summary.balances.minimumCkbCapital - summary.balances.totalEquivalentCkb;
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
    deficit: deficit > 0n ? deficit : 0n,
  };
}

export function errorSummary(
  error: unknown,
  options: { includeStack?: boolean } = {},
): Record<string, unknown> | string {
  return summarizeError(error, new Set<unknown>(), options.includeStack ?? true);
}

function summarizeError(
  error: unknown,
  seen: Set<unknown>,
  includeStack: boolean,
): Record<string, unknown> | string {
  if (error instanceof Error) {
    if (seen.has(error)) {
      return { message: "Circular error reference" };
    }
    seen.add(error);

    return {
      ...errorOwnProperties(error),
      name: error.name,
      message: logValue(error.message, seen),
      ...(includeStack && error.stack !== undefined ? { stack: logValue(error.stack, seen) } : {}),
      ...("txHash" in error ? { txHash: logValue(error.txHash, seen) } : {}),
      ...("status" in error ? { status: logValue(error.status, seen) } : {}),
      ...("isTimeout" in error ? { isTimeout: logValue(error.isTimeout, seen) } : {}),
      ...("cause" in error ? { cause: summarizeError(error.cause, seen, includeStack) } : {}),
    };
  }

  if (typeof error === "object" && error !== null) {
    return {
      message: "Non-Error object",
      details: logValue(error, seen),
    };
  }

  if (typeof error === "string") {
    return logValue(error, seen) as string;
  }

  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return error.toString();
  }

  return "Empty Error";
}

const ERROR_BUILTIN_KEYS = new Set(["name", "message", "stack", "cause"]);

function errorOwnProperties(error: Error): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    if (!ERROR_BUILTIN_KEYS.has(key)) {
      properties[key] = value;
    }
  }
  // CCC/CKB RPC errors carry retry evidence such as code, data, outPoint,
  // currentFee, and leastFee as enumerable Error fields.
  return logValue(properties, new Set<unknown>()) as Record<string, unknown>;
}

function confirmationFields(event: Extract<
  SendAndWaitForCommitEvent,
  { txHash: ccc.Hex; checks: number }
>): Record<string, unknown> {
  return {
    phase: "confirmation",
    txHash: event.txHash,
    status: event.status,
    checks: event.checks,
    elapsedMs: event.elapsedMs,
    ...("error" in event ? { error: errorSummary(event.error) } : {}),
  };
}

function jsonSafeEventFields(fields: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(logValue(fields, new Set<unknown>()), jsonLogReplacer)) as Record<string, unknown>;
}

const UNSUPPORTED_LOG_VALUE = "[Unsupported log value]";

function logValue(value: unknown, seen: Set<unknown>): unknown {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "function") {
    return UNSUPPORTED_LOG_VALUE;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => logValue(entry, seen));
    }
    const logged: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      logged[key] = logValue(entry, seen);
    }
    return logged;
  } finally {
    seen.delete(value);
  }
}
