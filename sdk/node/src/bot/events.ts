import type { ccc } from "@ckb-ccc/core";
import type { SupportedChain } from "../../../src/utils/chain.ts";
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
 * The eight bot events, each carrying what is new at its step; one turn emits at most six. A turn emits `bot.turn.started`,
 * `bot.state.read`, then either `bot.decision.skipped` or `bot.transaction.built`,
 * `bot.transaction.sent`, and `bot.transaction.committed`; the process's first turn also
 * emits `bot.chain.preflight` after its start. Any failure ends the turn and the process
 * with `bot.turn.failed` instead. Every event of one turn carries its `runId`.
 */
export type BotEvent =
  | { type: "bot.turn.started" }
  | ({ type: "bot.chain.preflight"; identity: BotIdentity } & ChainPreflightEvidence)
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
      error?: unknown;
    }
  | {
      type: "bot.transaction.committed";
      txHash: ccc.Hex;
      elapsedMs: number;
    }
  | {
      type: "bot.turn.failed";
      /** The thrown value; a terminal status after broadcast is the SDK's `TransactionWaitError`. */
      error: unknown;
    };

/**
 * Emits bot events as JSON lines on stdout. Each `bot.turn.started` opens a new `runId`,
 * the process id followed by the turn's number, so one turn's events share it and its
 * prefix ties the process's turns together.
 */
export class BotEventEmitter {
  private readonly chain: SupportedChain;
  private readonly processId: string;
  private turn = 0;

  constructor({ chain, processId }: { chain: SupportedChain; processId: string }) {
    this.chain = chain;
    this.processId = processId;
  }

  public emit(event: BotEvent): void {
    if (event.type === "bot.turn.started") {
      this.turn += 1;
    }
    writeJsonLine({
      ...event,
      chain: this.chain,
      runId: `${this.processId}-${String(this.turn)}`,
      timestamp: new Date().toISOString(),
    });
  }
}

/** The process's start time and pid. */
export function createProcessId(): string {
  return `${new Date().toISOString()}-${process.pid.toString(36)}`;
}
