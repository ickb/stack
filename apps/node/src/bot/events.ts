import type { ccc } from "@ckb-ccc/core";
import {
  toJsonLogRecord,
  writeJsonLine,
  type ChainPreflightEvidence,
  type JsonLogRecord,
  type PublicRpcEndpointIdentity,
  type SupportedChain,
} from "../shared/index.ts";
import type {
  BotActions,
  BotDecisionTranscript,
  BotStateSummary,
  BuildTransactionSkipReason,
} from "./runtime/types.ts";

/** Public identity of one bot process, emitted once with the chain preflight evidence. */
export interface BotIdentity {
  address: string;
  primaryLock: { codeHash: ccc.Hex; hashType: ccc.HashType; args: ccc.Hex };
  rpcEndpoint: PublicRpcEndpointIdentity;
}

/**
 * The seven bot events, each complete on its own. A turn emits `bot.turn.started`,
 * `bot.chain.preflight`, `bot.state.read`, then either `bot.decision.skipped` or
 * `bot.transaction.built`, `bot.transaction.sent`, and `bot.transaction.committed`;
 * any failure ends the turn with `bot.turn.failed` instead.
 */
export type BotEvent =
  | { type: "bot.turn.started" }
  | ({ type: "bot.chain.preflight"; identity: BotIdentity } & Omit<
      ChainPreflightEvidence,
      "chain"
    >)
  | ({ type: "bot.state.read" } & BotStateSummary)
  | {
      type: "bot.decision.skipped";
      reason: BuildTransactionSkipReason;
      actions: BotActions;
      decision: BotDecisionTranscript;
    }
  | {
      type: "bot.decision.skipped";
      reason: "capital_below_minimum";
      actions: BotActions;
      state: BotStateSummary;
      deficit: bigint;
    }
  | {
      type: "bot.transaction.built";
      actions: BotActions;
      fee: BotDecisionTranscript["fee"];
      transactionShape: BotDecisionTranscript["transactionShape"];
      decision: BotDecisionTranscript;
    }
  | {
      type: "bot.transaction.sent";
      txHash: ccc.Hex;
      /** `broadcast_ambiguous` when the send failed after the hash was known; the wait continues. */
      outcome: "broadcasted" | "broadcast_ambiguous";
      elapsedMs: number;
      fee: bigint;
      feeRate: ccc.Num;
      transactionShape: BotDecisionTranscript["transactionShape"];
      error?: unknown;
    }
  | {
      type: "bot.transaction.committed";
      txHash: ccc.Hex;
      status: string;
      elapsedMs: number;
      timeoutMs: number;
      intervalMs: number;
    }
  | {
      type: "bot.turn.failed";
      /** The thrown value; a terminal status after broadcast is the SDK's `TransactionWaitError`. */
      error: unknown;
    };

/** Emits bot events as JSON lines on stdout, or to `write` in tests. */
export class BotEventEmitter {
  private readonly context: {
    chain: SupportedChain;
    runId: string;
    write?: (event: JsonLogRecord) => void;
  };

  constructor(context: {
    chain: SupportedChain;
    runId: string;
    write?: (event: JsonLogRecord) => void;
  }) {
    this.context = context;
  }

  public emit(event: BotEvent): void {
    (this.context.write ?? writeJsonLine)(
      toJsonLogRecord({
        ...event,
        chain: this.context.chain,
        runId: this.context.runId,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}

export function createRunId(): string {
  return `${new Date().toISOString()}-${process.pid.toString(36)}`;
}
