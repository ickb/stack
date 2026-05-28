import { ccc } from "@ckb-ccc/core";
import { unique } from "@ickb/utils";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers";

const CKB = 100000000n;
const SECP256K1_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export const STOP_EXIT_CODE = 2;

export type SupportedChain = "mainnet" | "testnet";

export interface ChainIdentity {
  chain: SupportedChain;
  networkName: string;
  genesisHash: ccc.Hex;
  genesisMessage: string;
  genesisSource: string;
  addressPrefix: "ckb" | "ckt";
}

export const CHAIN_IDENTITIES = {
  mainnet: {
    chain: "mainnet",
    networkName: "ckb",
    genesisHash: "0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5",
    genesisMessage: "lina 0x18e020f6b1237a3d06b75121f25a7efa0550e4b3f44f974822f471902424c104",
    genesisSource: "https://raw.githubusercontent.com/nervosnetwork/ckb/develop/resource/specs/mainnet.toml",
    addressPrefix: "ckb",
  },
  testnet: {
    chain: "testnet",
    networkName: "ckb_testnet",
    genesisHash: "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606",
    genesisMessage: "aggron-v4",
    genesisSource: "https://raw.githubusercontent.com/nervosnetwork/ckb/develop/resource/specs/testnet.toml",
    addressPrefix: "ckt",
  },
} as const satisfies Record<SupportedChain, ChainIdentity>;

export type ChainPreflightClient = Pick<
  ccc.Client,
  "addressPrefix" | "getHeaderByNumber" | "getTipHeader"
>;

export interface ChainPreflightEvidence {
  chain: SupportedChain;
  expected: ChainIdentity;
  observed: {
    genesisHash: ccc.Hex;
    addressPrefix: string;
    tip: {
      hash: ccc.Hex;
      number: bigint;
      timestamp: bigint;
    };
  };
  matches: {
    genesisHash: boolean;
    addressPrefix: boolean;
  };
}

export function expectedChainIdentity(chain: SupportedChain): ChainIdentity {
  return CHAIN_IDENTITIES[chain];
}

export async function readChainPreflight(
  client: ChainPreflightClient,
  chain: SupportedChain,
): Promise<ChainPreflightEvidence> {
  const expected = expectedChainIdentity(chain);
  const [genesis, tip] = await Promise.all([
    client.getHeaderByNumber(0n),
    client.getTipHeader(),
  ]);

  if (genesis === undefined) {
    throw new Error(`Missing ${chain} genesis header`);
  }

  return {
    chain,
    expected,
    observed: {
      genesisHash: genesis.hash,
      addressPrefix: client.addressPrefix,
      tip: {
        hash: tip.hash,
        number: tip.number,
        timestamp: tip.timestamp,
      },
    },
    matches: {
      genesisHash: genesis.hash === expected.genesisHash,
      addressPrefix: client.addressPrefix === expected.addressPrefix,
    },
  };
}

export function assertChainPreflight(
  evidence: ChainPreflightEvidence,
): ChainPreflightEvidence {
  const failures: string[] = [];
  if (evidence.observed.genesisHash !== evidence.expected.genesisHash) {
    failures.push(
      `genesis hash expected ${evidence.expected.genesisHash} observed ${evidence.observed.genesisHash}`,
    );
  }
  if (evidence.observed.addressPrefix !== evidence.expected.addressPrefix) {
    failures.push(
      `address prefix expected ${evidence.expected.addressPrefix} observed ${evidence.observed.addressPrefix}`,
    );
  }
  if (failures.length > 0) {
    throw new Error(`Invalid ${evidence.chain} RPC chain identity: ${failures.join("; ")}`);
  }

  return evidence;
}

export async function verifyChainPreflight(
  client: ChainPreflightClient,
  chain: SupportedChain,
): Promise<ChainPreflightEvidence> {
  try {
    return assertChainPreflight(await readChainPreflight(client, chain));
  } catch (error) {
    if (isPublicChainPreflightFailure(error, chain)) {
      throw new Error(errorMessage(error), {
        cause: errorToLogValue(error, new WeakSet()),
      });
    }
    if (isRetryableRpcTransportError(error)) {
      throw new Error("fetch failed", {
        cause: { name: "TypeError", message: "fetch failed" },
      });
    }
    throw new Error(`Failed to verify ${chain} RPC chain identity`, {
      cause: safePreflightFailureCause(error),
    });
  }
}

function safePreflightFailureCause(error: unknown): { name: string } | { type: string } {
  if (error instanceof Error) {
    return { name: safeErrorName(error.name) };
  }
  return { type: error === null ? "null" : typeof error };
}

function safeErrorName(name: string): string {
  return /^[A-Za-z][\w.-]{0,63}$/u.test(name) ? name : "Error";
}

function isPublicChainPreflightFailure(error: unknown, chain: SupportedChain): boolean {
  const message = errorMessage(error);
  return message === `Missing ${chain} genesis header` ||
    message.startsWith(`Invalid ${chain} RPC chain identity:`);
}

function errorMessage(error: unknown): string {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : stringifyErrorMessage(error);
}

function stringifyErrorMessage(error: unknown): string {
  if (error === undefined || error === null) {
    return "Unknown error";
  }
  try {
    return JSON.stringify(toJsonLogValue(error, new WeakSet()), jsonLogReplacer);
  } catch {
    return "Unknown error";
  }
}

export function formatCkb(balance: bigint): string {
  const sign = balance < 0n ? "-" : "";
  const absolute = balance < 0n ? -balance : balance;
  const whole = absolute / CKB;
  const fraction = absolute % CKB;

  if (fraction === 0n) {
    return sign + whole.toString();
  }

  return `${sign}${whole.toString()}.${fraction.toString().padStart(8, "0").replace(/0+$/u, "")}`;
}

export function jsonLogReplacer(_: unknown, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

const UNSAFE_LOG_VALUE = "[Unsupported log value]";

export function isRetryableRpcTransportError(error: unknown): boolean {
  if (error instanceof TypeError && error.message === "fetch failed") {
    return true;
  }
  if (!(error instanceof Error) || error.message !== "fetch failed") {
    return false;
  }
  const cause = "cause" in error ? error.cause : undefined;
  return typeof cause === "object" && cause !== null &&
    "name" in cause && cause.name === "TypeError" &&
    "message" in cause && cause.message === "fetch failed";
}

export function isRetryableCkbStateRaceError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = "code" in error ? error.code : undefined;
  const data = "data" in error ? error.data : undefined;
  if (typeof code !== "number" || typeof data !== "string") {
    return false;
  }
  return (code === -1111 && data.includes("RBFRejected(")) ||
    (code === -301 && (
      data.includes("Resolve(Unknown(OutPoint(") ||
      data.includes("Resolve(Dead(OutPoint(")
    )) ||
    (code === -1107 && data.includes("Duplicated(Byte32("));
}

export function parseSleepInterval(
  intervalSeconds: number | undefined,
  envName: string,
): number {
  if (intervalSeconds === undefined || !Number.isFinite(intervalSeconds) || intervalSeconds < 1) {
    throw new Error("Invalid env " + envName);
  }

  const intervalMs = intervalSeconds * 1000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs > Math.floor(MAX_TIMER_DELAY_MS / 2)) {
    throw new Error("Invalid env " + envName);
  }

  return intervalMs;
}

export function parsePrivateKey(privateKey: string, envName: string): `0x${string}` {
  if (/^0x[0-9a-f]{64}$/u.test(privateKey)) {
    const value = BigInt(privateKey);
    if (value > 0n && value < SECP256K1_ORDER) {
      return privateKey as `0x${string}`;
    }
  }

  throw new Error("Invalid env " + envName);
}

export type RuntimeConfig = {
  chain: SupportedChain;
  privateKey: `0x${string}`;
  rpcUrl?: string;
  sleepIntervalMs: number;
  maxIterations: number | undefined;
  maxRetryableAttempts: number | undefined;
};

export function parseRpcUrl(rpcUrl: string, envName: string): string {
  for (let index = 0; index < rpcUrl.length; index += 1) {
    const code = rpcUrl.charCodeAt(index);
    if (/\s/u.test(rpcUrl[index] ?? "") || code < 0x20 || code === 0x7f) {
      throw new Error("Invalid env " + envName);
    }
  }
  if (rpcUrl === "") {
    throw new Error("Invalid env " + envName);
  }
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw new Error("Invalid env " + envName);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Invalid env " + envName);
  }
  return rpcUrl;
}

function parseOptionalRpcUrl(rpcUrl: unknown, envName: string): string | undefined {
  if (rpcUrl === undefined) {
    return undefined;
  }
  if (typeof rpcUrl !== "string") {
    throw new Error("Invalid env " + envName);
  }
  return parseRpcUrl(rpcUrl, envName);
}

export function parseMaxIterations(
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

function parsePositiveIntegerLimit(
  value: number | undefined,
  envName: string,
): number | undefined {
  if (value === undefined) {
    return;
  }

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Invalid env " + envName);
  }

  return value;
}

export function reachedMaxIterations(
  completedIterations: number,
  maxIterations: number | undefined,
): boolean {
  return maxIterations !== undefined && completedIterations >= maxIterations;
}

export function randomSleepIntervalMs(
  sleepIntervalMs: number,
  random: () => number = Math.random,
): number {
  // Sum of two uniforms gives bounded triangular jitter centered on the configured interval.
  return Math.floor(sleepIntervalMs * (random() + random()));
}

export function parseRuntimeConfig(configText: string, envName: string): RuntimeConfig {
  let config: unknown;
  try {
    config = JSON.parse(configText);
  } catch {
    throw new Error("Invalid env " + envName);
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("Invalid env " + envName);
  }

  const record = config as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (
      key !== "chain" &&
      key !== "privateKey" &&
      key !== "rpcUrl" &&
      key !== "sleepIntervalSeconds" &&
      key !== "maxIterations" &&
      key !== "maxRetryableAttempts"
    ) {
      throw new Error("Invalid env " + envName);
    }
  }
  if (
    typeof record.chain !== "string" ||
    typeof record.privateKey !== "string" ||
    typeof record.sleepIntervalSeconds !== "number" ||
    (record.maxIterations !== undefined && typeof record.maxIterations !== "number") ||
    (record.maxRetryableAttempts !== undefined && typeof record.maxRetryableAttempts !== "number")
  ) {
    throw new Error("Invalid env " + envName);
  }
  if (record.chain !== "mainnet" && record.chain !== "testnet") {
    throw new Error("Invalid env " + envName);
  }

  return {
    chain: record.chain,
    privateKey: parsePrivateKey(record.privateKey, envName),
    rpcUrl: parseOptionalRpcUrl(record.rpcUrl, envName),
    sleepIntervalMs: parseSleepInterval(record.sleepIntervalSeconds, envName),
    maxIterations: parseMaxIterations(record.maxIterations, envName),
    maxRetryableAttempts: parseMaxRetryableAttempts(record.maxRetryableAttempts, envName),
  };
}

export async function readRuntimeConfigEnv(
  fileEnvValue: string | undefined,
  fileEnvName: string,
): Promise<RuntimeConfig> {
  if (fileEnvValue === undefined || fileEnvValue === "") {
    throw new Error(`Empty env ${fileEnvName}`);
  }

  return parseRuntimeConfig(await readFileEnv(fileEnvValue, fileEnvName), fileEnvName);
}

async function readFileEnv(fileEnvValue: string, fileEnvName: string): Promise<string> {
  const secretPath = isAbsolute(fileEnvValue)
    ? fileEnvValue
    : resolve(process.env.INIT_CWD ?? process.cwd(), fileEnvValue);
  let fileSecret: string;
  try {
    fileSecret = await readFile(secretPath, "utf8");
  } catch (cause) {
    throw new Error(`Invalid file from env ${fileEnvName}`, { cause });
  }
  if (fileSecret === "") {
    throw new Error(`Empty file from env ${fileEnvName}`);
  }
  return fileSecret;
}

export function createPublicClient(
  chain: SupportedChain,
  rpcUrl: string | undefined,
): ccc.Client {
  const config = rpcUrl ? { url: rpcUrl } : undefined;
  return chain === "mainnet"
    ? new ccc.ClientPublicMainnet(config)
    : new ccc.ClientPublicTestnet(config);
}

export async function signerAccountLocks(
  signer: ccc.Signer,
  primaryLock: ccc.Script,
): Promise<ccc.Script[]> {
  return [...unique([
    primaryLock,
    ...(await signer.getAddressObjs()).map(({ script }) => script),
  ])];
}

export function accountPlainCkbBalance(
  capacityCells: readonly ccc.Cell[],
  accountLocks: readonly ccc.Script[],
): bigint {
  const accountLockHexes = new Set(accountLocks.map((lock) => lock.toHex()));
  return capacityCells.reduce(
    (total, cell) => total + plainCapacity(cell.cellOutput, cell.outputData, accountLockHexes),
    0n,
  );
}

export function postTransactionAccountPlainCkbBalance(
  tx: ccc.Transaction,
  capacityCells: readonly ccc.Cell[],
  accountLocks: readonly ccc.Script[],
): bigint {
  const accountLockHexes = new Set(accountLocks.map((lock) => lock.toHex()));
  const spentOutPoints = new Set(tx.inputs.map((input) => input.previousOutput.toHex()));
  const unspentCapacity = capacityCells.reduce(
    (total, cell) =>
      spentOutPoints.has(cell.outPoint.toHex())
        ? total
        : total + plainCapacity(cell.cellOutput, cell.outputData, accountLockHexes),
    0n,
  );
  const outputCapacity = tx.outputs.reduce(
    (total, output, index) => total + plainCapacity(output, tx.outputsData[index], accountLockHexes),
    0n,
  );

  return unspentCapacity + outputCapacity;
}

function plainCapacity(output: ccc.CellOutput, outputData: string | undefined, accountLockHexes: Set<string>): bigint {
  return isAccountPlainCapacityOutput(output, outputData, accountLockHexes) ? output.capacity : 0n;
}

function isAccountPlainCapacityOutput(output: ccc.CellOutput, outputData: string | undefined, accountLockHexes: Set<string>): boolean {
  return output.type === undefined && (outputData ?? "0x") === "0x" && accountLockHexes.has(output.lock.toHex());
}

function errorToLog(error: unknown): unknown {
  return errorToLogValue(error, new WeakSet());
}

function errorToLogValue(
  error: unknown,
  seen: WeakSet<object>,
): unknown {
  if (error instanceof Object && "stack" in error) {
    if (seen.has(error)) {
      return "[Circular]";
    }
    seen.add(error);
    const stack = typeof error.stack === "string" ? error.stack : "";
    const message = "message" in error && typeof error.message === "string"
      ? error.message
      : "Unknown error";
    const logged: Record<string, unknown> = {
      ...errorOwnProperties(error, seen),
      name: "name" in error ? error.name : undefined,
      message,
      txHash: "txHash" in error ? error.txHash : undefined,
      status: "status" in error ? error.status : undefined,
      isTimeout: "isTimeout" in error ? error.isTimeout : undefined,
      stack,
    };
    try {
      if ("cause" in error) {
        logged.cause = errorToLogValue(error.cause, seen);
      }
      return logged;
    } finally {
      seen.delete(error);
    }
  }

  if (typeof error === "object" && error !== null) {
    return toJsonLogValue(error, seen);
  }

  if (typeof error === "string") {
    return error;
  }

  return error ?? "Empty Error";
}

const ERROR_BUILTIN_KEYS = new Set(["name", "message", "stack", "cause"]);

function errorOwnProperties(error: object, seen: WeakSet<object>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(error)) {
    if (ERROR_BUILTIN_KEYS.has(key)) {
      continue;
    }
    properties[key] = toJsonLogValue(entry, seen);
  }
  return properties;
}

function toJsonLogValue(
  value: unknown,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "function") {
    return UNSAFE_LOG_VALUE;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (value instanceof Object && "stack" in value) {
    return errorToLogValue(value, seen);
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => toJsonLogValue(entry, seen));
    }
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      sanitized[key] = toJsonLogValue(entry, seen);
    }
    return sanitized;
  } finally {
    seen.delete(value);
  }
}

function shouldStopAfterError(error: unknown): boolean {
  return error instanceof Error &&
    error.name === "TransactionConfirmationError" &&
    "isTimeout" in error &&
    error.isTimeout === true;
}

export function handleLoopError(
  executionLog: Record<string, unknown>,
  error: unknown,
): boolean {
  executionLog.error = errorToLog(error);
  if (shouldStopAfterError(error)) {
    process.exitCode = STOP_EXIT_CODE;
    return true;
  }

  return false;
}

export function logExecution(
  executionLog: Record<string, unknown>,
  startTime: Date,
): void {
  executionLog.ElapsedSeconds = Math.round(
    (Date.now() - startTime.getTime()) / 1000,
  );
  writeJsonLine(executionLog);
}

export function writeJsonLine(record: unknown): void {
  process.stdout.write(`${JSON.stringify(toJsonLogValue(record, new WeakSet()), jsonLogReplacer)}\n`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
