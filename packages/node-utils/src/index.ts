import { ccc } from "@ckb-ccc/core";
import { unique } from "@ickb/utils";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers";

const CKB = 100000000n;
const SECP256K1_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
// Jitter can double the configured interval; keep the result within Node's timer limit.
const MAX_SAFE_SLEEP_INTERVAL_MS = 1_073_741_823;

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
  "addressPrefix" | "getHeaderByNumber" | "getTipHeader" | "url"
>;

export interface ChainPreflightEvidence {
  chain: SupportedChain;
  redactedRpcUrl: string;
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
    redactedRpcUrl: redactRpcUrl(client.url),
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
    const secrets = { rpcUrl: client.url };
    throw new Error(redactRpcUrlInError(error, secrets), {
      cause: errorToLogValue(error, secrets, new WeakSet()),
    });
  }
}

function redactRpcUrlInError(error: unknown, secrets: SecretRedactionContext): string {
  const message = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : stringifyErrorMessage(error, secrets);
  return redactSecretText(message, secrets);
}

export function redactSecretText(text: string, secrets: SecretRedactionContext = {}): string {
  let redacted = text;
  if (secrets.privateKey) {
    redacted = redacted.split(secrets.privateKey).join("<redacted-private-key>");
  }
  if (secrets.rpcUrl) {
    redacted = redacted.split(secrets.rpcUrl).join(secrets.redactedRpcUrl ?? redactRpcUrl(secrets.rpcUrl));
    redacted = redactRpcUrlSecrets(redacted, secrets.rpcUrl);
  }
  return redacted;
}

function stringifyErrorMessage(error: unknown, secrets: SecretRedactionContext): string {
  if (error === undefined || error === null) {
    return "Unknown error";
  }
  try {
    return JSON.stringify(sanitizeLogValue(error, secrets, new WeakSet()), jsonLogReplacer);
  } catch {
    return "Unknown error";
  }
}

function redactRpcUrlSecrets(text: string, rpcUrl: string): string {
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    return text;
  }

  const replacements = new Array<[string, string]>();
  if (url.username !== "") {
    replacements.push([url.username, "<redacted-rpc-username>"]);
    replacements.push([safeDecodeURIComponent(url.username), "<redacted-rpc-username>"]);
  }
  if (url.password !== "") {
    replacements.push([url.password, "<redacted-rpc-password>"]);
    replacements.push([safeDecodeURIComponent(url.password), "<redacted-rpc-password>"]);
  }
  for (const value of url.searchParams.values()) {
    replacements.push([value, "<redacted-rpc-query>"]);
  }
  for (const value of rawSearchParamValues(url.search)) {
    replacements.push([value, "<redacted-rpc-query>"]);
  }
  return replaceUrlSecrets(text, replacements);
}

function rawSearchParamValues(search: string): string[] {
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (query === "") {
    return [];
  }
  return query.split("&").map((part) => {
    const separator = part.indexOf("=");
    return separator === -1 ? "" : part.slice(separator + 1);
  });
}

function replaceUrlSecrets(text: string, replacements: Array<[string, string]>): string {
  const unique = new Map(replacements.filter(([secret]) => secret !== ""));
  if (unique.size === 0) {
    return text;
  }
  const pattern = [...unique.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  return text.replace(new RegExp(pattern, "gu"), (match) => unique.get(match) ?? match);
}

function safeDecodeURIComponent(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return "";
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function redactRpcUrl(rpcUrl: string): string {
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    return "<invalid-url>";
  }

  if (url.username !== "" || url.password !== "") {
    url.username = "redacted";
    url.password = url.password === "" ? "" : "redacted";
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    url.pathname = "/...";
  }
  if (url.search !== "") {
    const redactedParams = new URLSearchParams();
    for (const [key] of url.searchParams) {
      redactedParams.append(key, "redacted");
    }
    url.search = redactedParams.toString();
  }

  return url.toString();
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

export function parseSleepInterval(
  intervalSeconds: number | undefined,
  envName: string,
): number {
  if (intervalSeconds === undefined || !Number.isFinite(intervalSeconds) || intervalSeconds < 1) {
    throw new Error("Invalid env " + envName);
  }

  const intervalMs = intervalSeconds * 1000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs > MAX_SAFE_SLEEP_INTERVAL_MS) {
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
  maxIterations?: number;
  maxRetryableAttempts?: number;
};

export interface SecretRedactionContext {
  privateKey?: string;
  rpcUrl?: string;
  redactedRpcUrl?: string;
}

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

export function parseMaxIterations(
  value: number | undefined,
  envName: string,
): number | undefined {
  return parsePositiveSafeInteger(value, envName);
}

export function parseMaxRetryableAttempts(
  value: number | undefined,
  envName: string,
): number | undefined {
  return parsePositiveSafeInteger(value, envName);
}

function parsePositiveSafeInteger(
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
    (record.rpcUrl !== undefined && typeof record.rpcUrl !== "string") ||
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
    rpcUrl: record.rpcUrl !== undefined ? parseRpcUrl(record.rpcUrl, envName) : undefined,
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

function errorToLog(error: unknown, secrets: SecretRedactionContext = {}): unknown {
  return errorToLogValue(error, secrets, new WeakSet());
}

function errorToLogValue(
  error: unknown,
  secrets: SecretRedactionContext,
  seen: WeakSet<object>,
): unknown {
  if (error instanceof Object && "stack" in error) {
    if (seen.has(error)) {
      return "[Circular]";
    }
    seen.add(error);
    const stack = redactSecretText(typeof error.stack === "string" ? error.stack : "", secrets);
    const logged: Record<string, unknown> = {
      name: "name" in error ? error.name : undefined,
      message:
        "message" in error && typeof error.message === "string"
          ? redactSecretText(error.message, secrets)
          : "Unknown error",
      txHash: "txHash" in error ? error.txHash : undefined,
      status: "status" in error ? error.status : undefined,
      stack,
    };
    try {
      if ("cause" in error) {
        logged.cause = errorToLogValue((error as { cause?: unknown }).cause, secrets, seen);
      }
      return logged;
    } finally {
      seen.delete(error);
    }
  }

  if (typeof error === "object" && error !== null) {
    return sanitizeLogValue(error, secrets, new WeakSet());
  }

  if (typeof error === "string") {
    return redactSecretText(error, secrets);
  }

  return error ?? "Empty Error";
}

function sanitizeLogValue(
  value: unknown,
  secrets: SecretRedactionContext,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") {
    return redactSecretText(value, secrets);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (value instanceof Object && "stack" in value) {
    return errorToLogValue(value, secrets, seen);
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => sanitizeLogValue(entry, secrets, seen));
    }
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveLogKey(key)) {
        continue;
      }
      sanitized[key] = sanitizeLogValue(entry, secrets, seen);
    }
    return sanitized;
  } finally {
    seen.delete(value);
  }
}

function isSensitiveLogKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/gu, "");
  return ["privatekey", "rpcurl", "apikey", "password", "token", "secret"].some(
    (sensitiveKey) => normalized === sensitiveKey || normalized.endsWith(sensitiveKey),
  );
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
  secrets: SecretRedactionContext = {},
): boolean {
  executionLog.error = errorToLog(error, secrets);
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
  process.stdout.write(`${JSON.stringify(record, jsonLogReplacer)}\n`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
