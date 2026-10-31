import type { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { optionalEnv } from "../shared/runtime_config.ts";

/**
 * Reads the optional `BOT_MAX_FEE_RATE`, in shannons per kB: the most the bot plans to pay
 * whatever rate the node reports, at least the default node admission floor. Unset or empty
 * leaves the sampled rate uncapped. Errors name only the variable.
 */
export function readBotMaxFeeRate(env: NodeJS.ProcessEnv): ccc.Num | undefined {
  const value = optionalEnv(env, "BOT_MAX_FEE_RATE");
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
