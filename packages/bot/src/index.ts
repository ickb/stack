import { readRuntimeConfigEnv, type RuntimeConfig } from "@ickb/node-utils";

export {
  isRetryableBotError,
  iterationFailureEventFields,
  nonRetryableTerminalFailureExitCode,
  reachedMaxRetryableAttempts,
} from "./bot/failure.ts";
export { completeTerminalIteration, runBotLoop } from "./bot/loop.ts";
export type { BotLoopContext, BotLoopOperations } from "./bot/loop.ts";
export { readBotState } from "./bot/state.ts";
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
