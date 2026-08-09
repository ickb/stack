import { readRuntimeConfigEnv, type RuntimeConfig } from "@ickb/node-utils";
import {
  DEFAULT_TESTER_FEE_POLICY,
  MAX_TESTER_FEE_BASE,
  RANDOM_ORDER_SCENARIO,
  TESTER_SCENARIOS,
  isTesterScenarioSelection,
  type TesterFeePolicy,
  type TesterScenario,
  type TesterScenarioSelection,
} from "../runtime/testerTypes.ts";

/**
 * Reads tester runtime config from `TESTER_CONFIG_FILE`.
 *
 * @remarks The underlying parser keeps invalid config errors generic so secrets
 * and signing material are not copied into logs.
 */
export async function readTesterRuntimeConfig(
  env: NodeJS.ProcessEnv,
): Promise<RuntimeConfig> {
  return readRuntimeConfigEnv(env["TESTER_CONFIG_FILE"], "TESTER_CONFIG_FILE");
}
/**
 * Reads and validates the tester scenario selector from environment.
 *
 * @remarks Missing `TESTER_SCENARIO` defaults to `auto`.
 */
export function readTesterScenario(env: NodeJS.ProcessEnv): TesterScenarioSelection {
  const value = env["TESTER_SCENARIO"] ?? "auto";
  if (isTesterScenarioSelection(value)) {
    return value;
  }
  throw new Error("Invalid env TESTER_SCENARIO");
}
/**
 * Reads raw-order fee policy from environment and enforces safe fee bounds.
 *
 * @remarks Missing values use the default tester fee policy. Values are integer
 * strings and `TESTER_FEE` must remain below `TESTER_FEE_BASE`.
 */
export function readTesterFeePolicy(env: NodeJS.ProcessEnv): TesterFeePolicy {
  const fee =
    readOptionalBigintEnv(env["TESTER_FEE"], "TESTER_FEE") ??
    DEFAULT_TESTER_FEE_POLICY.fee;
  const feeBase =
    readOptionalBigintEnv(env["TESTER_FEE_BASE"], "TESTER_FEE_BASE") ??
    DEFAULT_TESTER_FEE_POLICY.feeBase;
  if (feeBase <= 0n) {
    throw new Error("Invalid env TESTER_FEE_BASE: expected a positive integer");
  }
  if (feeBase > MAX_TESTER_FEE_BASE) {
    throw new Error(
      `Invalid env TESTER_FEE_BASE: expected at most ${MAX_TESTER_FEE_BASE.toString()}`,
    );
  }
  if (fee >= feeBase) {
    throw new Error(
      "Invalid tester fee policy: TESTER_FEE must be less than TESTER_FEE_BASE",
    );
  }
  return { fee, feeBase };
}
/**
 * Selects a tester scenario using the supplied random source.
 */
export function randomTesterScenario(
  random: () => number = Math.random,
  scenarios: readonly TesterScenario[] = TESTER_SCENARIOS,
): TesterScenario {
  const index = Math.floor(random() * scenarios.length);
  return scenarios[index] ?? RANDOM_ORDER_SCENARIO;
}
function readOptionalBigintEnv(
  value: string | undefined,
  name: string,
): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`Invalid env ${name}: expected an unsigned integer`);
  }
  return BigInt(value);
}
