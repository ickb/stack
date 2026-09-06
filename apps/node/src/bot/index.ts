import { readRuntimeConfigEnv, type RuntimeConfig } from "../shared/index.ts";
export { BotEventEmitter, createRunId } from "./events.ts";
export { handleTurnFailure } from "./failure.ts";
export type { Runtime } from "./runtime/types.ts";
export { runBotTurn } from "./turn.ts";

/**
 * Reads bot runtime config from `BOT_CHAIN`, `BOT_RPC_URL`, and the `BOT_PRIVATE_KEY_FILE` key file.
 */
export async function readBotRuntimeConfig(
  env: NodeJS.ProcessEnv,
): Promise<RuntimeConfig> {
  return readRuntimeConfigEnv(env, "BOT");
}
