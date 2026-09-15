import { ccc } from "@ckb-ccc/core";
import { DEFAULT_ORDER_FEE_BASE } from "../../../src/conversion/sdk_estimate.ts";
import { readRuntimeConfigEnv, type RuntimeConfig } from "../shared/index.ts";
import type { Direction, Kind, Override } from "./draw.ts";

/**
 * Reads `STIMULUS_CHAIN`, `STIMULUS_RPC_URL`, and the key file named by
 * `STIMULUS_PRIVATE_KEY_FILE`, refusing every chain but testnet: the generator posts
 * random and deliberately unprofitable orders, which only test money may back.
 */
export async function readStimulusConfig(env: NodeJS.ProcessEnv): Promise<RuntimeConfig> {
  const config = await readRuntimeConfigEnv(env, "STIMULUS");
  if (config.chain !== "testnet") {
    throw new Error(
      "Invalid env STIMULUS_CHAIN: the stimulus generator runs on testnet only",
    );
  }
  return config;
}

/**
 * Reads the optional knobs that pin one draw each: `STIMULUS_KIND`, `STIMULUS_DIRECTION`,
 * `STIMULUS_AMOUNT` (whole CKB or iCKB, or `max`), and `STIMULUS_FEE` (numerator over
 * the fixed base). Unset knobs leave their draw random.
 */
export function readStimulusOverride(env: NodeJS.ProcessEnv): Override {
  const override: Override = {};
  const kind = env["STIMULUS_KIND"];
  if (kind !== undefined) {
    override.kind = parseChoice<Kind>(kind, ["order", "conversion"], "STIMULUS_KIND");
  }
  const direction = env["STIMULUS_DIRECTION"];
  if (direction !== undefined) {
    override.direction = parseChoice<Direction>(
      direction,
      ["ckb-to-ickb", "ickb-to-ckb"],
      "STIMULUS_DIRECTION",
    );
  }
  const amount = env["STIMULUS_AMOUNT"];
  if (amount !== undefined) {
    override.amount = amount === "max" ? "max" : parseAmount(amount);
  }
  const fee = env["STIMULUS_FEE"];
  if (fee !== undefined) {
    const numerator = parseUnsigned(fee, "STIMULUS_FEE");
    if (numerator >= DEFAULT_ORDER_FEE_BASE) {
      throw new Error(
        `Invalid env STIMULUS_FEE: expected less than ${DEFAULT_ORDER_FEE_BASE.toString()}`,
      );
    }
    override.fee = numerator;
  }
  return override;
}

function parseChoice<T extends string>(
  value: string,
  choices: readonly T[],
  name: string,
): T {
  const choice = choices.find((candidate) => candidate === value);
  if (choice === undefined) {
    throw new Error(`Invalid env ${name}: expected one of ${choices.join(", ")}`);
  }
  return choice;
}

function parseAmount(value: string): bigint {
  // Digits, at most one point, at most eight decimals: what `fixedPointFrom` reads exactly.
  if (!/^\d+\.?\d{0,8}$/u.test(value) || ccc.fixedPointFrom(value) <= 0n) {
    throw new Error(
      "Invalid env STIMULUS_AMOUNT: expected a positive decimal amount or max",
    );
  }
  return ccc.fixedPointFrom(value);
}

function parseUnsigned(value: string, name: string): bigint {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`Invalid env ${name}: expected an unsigned integer`);
  }
  return BigInt(value);
}
