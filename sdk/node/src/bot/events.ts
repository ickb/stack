import type { ccc } from "@ckb-ccc/core";
import type { SupportedChain } from "../../../src/utils/index.ts";
import type { ChainPreflightEvidence } from "../shared/chain.ts";
import { writeJsonLine } from "../shared/logging.ts";
import type { PublicRpcEndpointIdentity } from "../shared/runtime_config.ts";
import type {
  BotDecision,
  BotStateSummary,
  BuildTransactionSkipReason,
} from "./types.ts";

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
      decision: BotDecision;
    }
  | { type: "bot.transaction.built"; decision: BotDecision }
  | {
      type: "bot.transaction.sent";
      txHash: ccc.Hex;
      /** `broadcast_ambiguous` when the send failed after the hash was known; the wait continues. */
      outcome: "broadcasted" | "broadcast_ambiguous";
      elapsedMs: number;
      fee: bigint;
      feeRate: ccc.Num;
      transactionShape: BotDecision["transactionShape"];
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

/** Emits bot events as JSON lines on stdout. */
export class BotEventEmitter {
  private readonly context: { chain: SupportedChain; runId: string };

  constructor(context: { chain: SupportedChain; runId: string }) {
    this.context = context;
  }

  public emit(event: BotEvent): void {
    writeJsonLine({
      ...event,
      chain: this.context.chain,
      runId: this.context.runId,
      timestamp: new Date().toISOString(),
    });
  }
}

export function createRunId(): string {
  return `${new Date().toISOString()}-${process.pid.toString(36)}`;
}
