import { readRuntimeConfigEnv, type RuntimeConfig } from "../shared/index.ts";
export { handleTurnFailure } from "./bot/failure.ts";
export { runBotTurn } from "./bot/turn.ts";
export { BotEventEmitter, createRunId } from "./observability/events.ts";
export type { Runtime } from "./runtime/types.ts";

/**
 * Reads bot runtime config from `BOT_CHAIN`, `BOT_RPC_URL`, and the `BOT_PRIVATE_KEY_FILE` key file.
 */
export async function readBotRuntimeConfig(
  env: NodeJS.ProcessEnv,
): Promise<RuntimeConfig> {
  return readRuntimeConfigEnv(env, "BOT");
}
