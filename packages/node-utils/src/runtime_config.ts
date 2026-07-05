import path from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers";
import type { SupportedChain } from "./chain.ts";

const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const INVALID_ENV_MESSAGE = "Invalid env ";
const CHAIN_KEY = "chain";
const PRIVATE_KEY_KEY = "privateKey";
const RPC_URL_KEY = "rpcUrl";
const SLEEP_INTERVAL_SECONDS_KEY = "sleepIntervalSeconds";
const MAX_ITERATIONS_KEY = "maxIterations";
const MAX_RETRYABLE_ATTEMPTS_KEY = "maxRetryableAttempts";
const RUNTIME_CONFIG_KEYS = new Set([
  CHAIN_KEY,
  PRIVATE_KEY_KEY,
  RPC_URL_KEY,
  SLEEP_INTERVAL_SECONDS_KEY,
  MAX_ITERATIONS_KEY,
  MAX_RETRYABLE_ATTEMPTS_KEY,
]);

/** Runtime configuration loaded from a secret-backed JSON file. */
export interface RuntimeConfig {
  /** Public CKB chain expected by the app. */
  chain: SupportedChain;

  /** Secp256k1 private key used only for signing. */
  privateKey: `0x${string}`;

  /** Optional RPC URL override for the selected public chain. */
  rpcUrl?: string;

  /** Loop sleep interval in milliseconds, parsed from `sleepIntervalSeconds`. */
  sleepIntervalMs: number;

  /** Optional maximum completed loop iterations before stopping. */
  maxIterations: number | undefined;

  /** Optional maximum retryable failures before stopping. */
  maxRetryableAttempts: number | undefined;
}

/**
 * Reads and validates a JSON runtime config from the file named by an environment value.
 *
 * @remarks
 * Relative file paths resolve against `INIT_CWD` when present, otherwise
 * `process.cwd()`. Invalid file contents throw generic env-name errors so config
 * values and signing material are not copied into logs.
 */
export async function readRuntimeConfigEnv(
  fileEnvValue: string | undefined,
  fileEnvName: string,
): Promise<RuntimeConfig> {
  if (fileEnvValue === undefined || fileEnvValue === "") {
    throw new Error(`Empty env ${fileEnvName}`);
  }

  return parseRuntimeConfig(await readFileEnv(fileEnvValue, fileEnvName), fileEnvName);
}

/**
 * Returns true once the configured loop iteration limit has been reached.
 */
export function reachedMaxIterations(
  completedIterations: number,
  maxIterations: number | undefined,
): boolean {
  return maxIterations !== undefined && completedIterations >= maxIterations;
}

/**
 * Returns a jittered sleep interval centered on the configured interval.
 */
export function randomSleepIntervalMs(
  sleepIntervalMs: number,
  random: () => number = Math.random,
): number {
  // Sum of two uniforms gives bounded triangular jitter centered on the configured interval.
  return Math.floor(sleepIntervalMs * (random() + random()));
}

/**
 * Resolves after the given number of milliseconds.
 */
export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readFileEnv(fileEnvValue: string, fileEnvName: string): Promise<string> {
  const secretPath = path.isAbsolute(fileEnvValue)
    ? fileEnvValue
    : path.resolve(process.env["INIT_CWD"] ?? process.cwd(), fileEnvValue);
  let fileSecret: string;
  try {
    const fileSystem = await import("node:fs/promises");
    fileSecret = await fileSystem.readFile(secretPath, "utf8");
  } catch (cause) {
    throw new Error(`Invalid file from env ${fileEnvName}`, { cause });
  }
  if (fileSecret === "") {
    throw new Error(`Empty file from env ${fileEnvName}`);
  }
  return fileSecret;
}

export function parseRuntimeConfig(configText: string, envName: string): RuntimeConfig {
  const record = parseRuntimeConfigRecord(configText, envName);
  assertKnownRuntimeConfigKeys(record, envName);
  const chain = parseSupportedChain(record[CHAIN_KEY], envName);
  const privateKey = parseRequiredString(record[PRIVATE_KEY_KEY], envName);
  const rpcUrl = parseOptionalRpcUrl(record[RPC_URL_KEY], envName);
  const sleepIntervalSeconds = parseRequiredNumber(
    record[SLEEP_INTERVAL_SECONDS_KEY],
    envName,
  );
  const maxIterations = parseOptionalNumber(record[MAX_ITERATIONS_KEY], envName);
  const maxRetryableAttempts = parseOptionalNumber(
    record[MAX_RETRYABLE_ATTEMPTS_KEY],
    envName,
  );

  return {
    chain,
    privateKey: parsePrivateKey(privateKey, envName),
    rpcUrl,
    sleepIntervalMs: parseSleepInterval(sleepIntervalSeconds, envName),
    maxIterations: parseMaxIterations(maxIterations, envName),
    maxRetryableAttempts: parseMaxRetryableAttempts(maxRetryableAttempts, envName),
  };
}

function parseRuntimeConfigRecord(
  configText: string,
  envName: string,
): Record<string, unknown> {
  let config: unknown;
  try {
    config = JSON.parse(configText);
  } catch {
    throw invalidEnvError(envName);
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw invalidEnvError(envName);
  }
  return Object.fromEntries(Object.entries(config));
}

function assertKnownRuntimeConfigKeys(
  record: Record<string, unknown>,
  envName: string,
): void {
  for (const key of Object.keys(record)) {
    if (!RUNTIME_CONFIG_KEYS.has(key)) {
      throw invalidEnvError(envName);
    }
  }
}

function parseSupportedChain(value: unknown, envName: string): SupportedChain {
  if (value !== "mainnet" && value !== "testnet") {
    throw invalidEnvError(envName);
  }
  return value;
}

function parseOptionalRpcUrl(rpcUrl: unknown, envName: string): string | undefined {
  if (rpcUrl === undefined) {
    return undefined;
  }
  if (typeof rpcUrl !== "string") {
    throw invalidEnvError(envName);
  }
  return parseRpcUrl(rpcUrl, envName);
}

function parseOptionalNumber(value: unknown, envName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseRequiredNumber(value, envName);
}

function parseRequiredString(value: unknown, envName: string): string {
  if (typeof value !== "string") {
    throw invalidEnvError(envName);
  }
  return value;
}

function parseRequiredNumber(value: unknown, envName: string): number {
  if (typeof value !== "number") {
    throw invalidEnvError(envName);
  }
  return value;
}

function parsePrivateKey(privateKey: string, envName: string): `0x${string}` {
  if (isPrivateKeyHex(privateKey)) {
    const value = BigInt(privateKey);
    if (value > 0n && value < SECP256K1_ORDER) {
      return privateKey;
    }
  }

  throw invalidEnvError(envName);
}

function parseSleepInterval(
  intervalSeconds: number | undefined,
  envName: string,
): number {
  if (
    intervalSeconds === undefined ||
    !Number.isFinite(intervalSeconds) ||
    intervalSeconds < 1
  ) {
    throw invalidEnvError(envName);
  }

  const intervalMs = intervalSeconds * 1000;
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs > Math.floor(MAX_TIMER_DELAY_MS / 2)
  ) {
    throw invalidEnvError(envName);
  }

  return intervalMs;
}

function parseMaxIterations(
  value: number | undefined,
  envName: string,
): number | undefined {
  return parsePositiveIntegerLimit(value, envName);
}

function parseMaxRetryableAttempts(
  value: number | undefined,
  envName: string,
): number | undefined {
  return parsePositiveIntegerLimit(value, envName);
}

function parseRpcUrl(rpcUrl: string, envName: string): string {
  for (let index = 0; index < rpcUrl.length; index += 1) {
    const code = rpcUrl.codePointAt(index);
    if (
      code === undefined ||
      /\s/u.test(rpcUrl[index] ?? "") ||
      code < 0x20 ||
      code === 0x7f
    ) {
      throw invalidEnvError(envName);
    }
  }
  if (rpcUrl === "") {
    throw invalidEnvError(envName);
  }
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw invalidEnvError(envName);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalidEnvError(envName);
  }
  return rpcUrl;
}

function parsePositiveIntegerLimit(
  value: number | undefined,
  envName: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidEnvError(envName);
  }

  return value;
}

function isPrivateKeyHex(value: string): value is `0x${string}` {
  return /^0x[\da-f]{64}$/u.test(value);
}

function invalidEnvError(envName: string): Error {
  return new Error(INVALID_ENV_MESSAGE + envName);
}
