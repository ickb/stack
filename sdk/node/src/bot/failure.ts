import type { BotEventEmitter } from "./events.ts";

/**
 * Emits the failure event and exits 1 so the service manager starts another turn. Every
 * failure is safe to follow with a fresh turn: it rebuilds from committed state, and a
 * transaction still pending from this turn conflicts with the rebuilt one at the node.
 */
export function handleTurnFailure(events: BotEventEmitter, error: unknown): void {
  events.emit({ type: "bot.turn.failed", error });
  process.exitCode = 1;
}
