import { ccc } from "@ckb-ccc/core";
import { unique } from "@ickb/utils";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { setTimeout } from "node:timers";

const CKB = 100000000n;

export const STOP_EXIT_CODE = 2;

export type SupportedChain = "mainnet" | "testnet";

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

  return intervalSeconds * 1000;
}

export function parsePrivateKey(privateKey: string, envName: string): `0x${string}` {
  if (/^0x[0-9a-f]{64}$/u.test(privateKey)) {
    return privateKey as `0x${string}`;
  }

  throw new Error("Invalid env " + envName);
}

export type RuntimeConfig = {
  chain: SupportedChain;
  privateKey: `0x${string}`;
  rpcUrl: string;
  sleepIntervalMs: number;
  maxIterations: number | undefined;
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

export function parseMaxIterations(
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
      key !== "maxIterations"
    ) {
      throw new Error("Invalid env " + envName);
    }
  }
  if (
    typeof record.chain !== "string" ||
    typeof record.privateKey !== "string" ||
    typeof record.rpcUrl !== "string" ||
    typeof record.sleepIntervalSeconds !== "number" ||
    record.maxIterations !== undefined && typeof record.maxIterations !== "number"
  ) {
    throw new Error("Invalid env " + envName);
  }
  if (record.chain !== "mainnet" && record.chain !== "testnet") {
    throw new Error("Invalid env " + envName);
  }

  return {
    chain: record.chain,
    privateKey: parsePrivateKey(record.privateKey, envName),
    rpcUrl: parseRpcUrl(record.rpcUrl, envName),
    sleepIntervalMs: parseSleepInterval(record.sleepIntervalSeconds, envName),
    maxIterations: parseMaxIterations(record.maxIterations, envName),
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
  const secretPath = fileEnvValue;
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

function errorToLog(error: unknown): unknown {
  if (error instanceof Object && "stack" in error) {
    const stack = error.stack ?? "";
    return {
      name: "name" in error ? error.name : undefined,
      message:
        "message" in error && typeof error.message === "string"
          ? error.message
          : "Unknown error",
      txHash: "txHash" in error ? error.txHash : undefined,
      status: "status" in error ? error.status : undefined,
      stack,
    };
  }

  return error ?? "Empty Error";
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
  process.stdout.write(`${JSON.stringify(record, jsonLogReplacer)}\n`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
