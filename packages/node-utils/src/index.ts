import { ccc } from "@ckb-ccc/core";
import { unique } from "@ickb/utils";
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

function jsonLogReplacer(_: unknown, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string") {
    return redactSensitiveLogText(value);
  }
  return value;
}

export function redactSensitiveLogText(value: string): string {
  return value
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/giu, "$1[redacted]@")
    .replace(
      /\b([a-z0-9_]*private[_-]?key|[a-z0-9_]*seed(?:[_-]?phrase)?|[a-z0-9_]*mnemonic|(?:raw[_-]?)?env)\b\s*[:=]\s*\S+/giu,
      "$1=[redacted]",
    )
    .replace(
      /\b(witness(?:es)?|signed[_-]?transaction|raw[_-]?transaction|script)\b\s*[:=]?\s*0x[0-9a-f]{65,}/giu,
      "$1 [redacted]",
    )
    .replace(/0x[0-9a-f]{129,}/giu, "[redacted-hex]")
    .replace(
      /\{[^{}]*(?:"codeHash"|"hashType"|"args")[^{}]*(?:"codeHash"|"hashType"|"args")[^{}]*\}/giu,
      "[redacted-script]",
    );
}

export function parseSupportedChain(
  chain: string | undefined,
  envName: string,
): SupportedChain {
  if (chain === "mainnet" || chain === "testnet") {
    return chain;
  }

  throw new Error("Invalid env " + envName + ": " + (chain || "Empty"));
}

export function parseSleepInterval(
  intervalSeconds: string | undefined,
  envName: string,
): number {
  const seconds = Number(intervalSeconds);
  if (intervalSeconds === undefined || !Number.isFinite(seconds) || seconds < 1) {
    throw new Error("Invalid env " + envName);
  }

  return seconds * 1000;
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
