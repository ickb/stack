import { readRuntimeConfigEnv, type RuntimeConfig } from "@ickb/node-utils";

export { handleTurnFailure, isRetryableBotError } from "./bot/failure.ts";
export { readBotState } from "./bot/state.ts";
export { runBotTurn } from "./bot/turn.ts";
export type { BotTurnContext, BotTurnOperations } from "./bot/turn.ts";
export { BotEventEmitter, createRunId } from "./observability/events.ts";
export type { Runtime } from "./runtime/types.ts";

/**
 * Reads bot runtime config from `BOT_CONFIG_FILE`.
 */
export async function readBotRuntimeConfig(
  env: NodeJS.ProcessEnv,
): Promise<RuntimeConfig> {
  return readRuntimeConfigEnv(env["BOT_CONFIG_FILE"], "BOT_CONFIG_FILE");
}
