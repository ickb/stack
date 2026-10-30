import type { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { optionalEnv } from "../shared/runtime_config.ts";

/**
 * Reads the optional `BOT_MAX_FEE_RATE`, in shannons per kB: the most the bot plans to pay
 * whatever rate the node reports, at least the default node admission floor. Unset or empty
 * leaves the sampled rate uncapped. Errors name only the variable.
 */
export function readBotMaxFeeRate(env: NodeJS.ProcessEnv): ccc.Num | undefined {
  const value = optionalEnv(env, "BOT_MAX_FEE_RATE")?.value;
  if (value === undefined) {
    return undefined;
  }
  if (!/^(?:0|[1-9]\d*)$/u.test(value) || BigInt(value) < cccA.DEFAULT_MIN_FEE_RATE) {
    throw new Error(
      `Invalid env BOT_MAX_FEE_RATE: expected an integer of at least ${cccA.DEFAULT_MIN_FEE_RATE.toString()}`,
    );
  }
  return BigInt(value);
}

/**
 * Reads the optional `BOT_TURN_MINUTES`, whole minutes from one turn start to the next, 1 to
 * 10, default 10. The app's estimates assume ten-minute turns, so a shorter interval keeps
 * them an upper bound while a longer one would make them optimistic and leave too few turns
 * in a forty-minute deposit window. Returns milliseconds. Errors name only the variable.
 */
export function readBotTurnMs(env: NodeJS.ProcessEnv): number {
  const value = optionalEnv(env, "BOT_TURN_MINUTES")?.value ?? "10";
  if (!/^(?:[1-9]|10)$/u.test(value)) {
    throw new Error("Invalid env BOT_TURN_MINUTES: expected whole minutes from 1 to 10");
  }
  return Number(value) * 60_000;
}
