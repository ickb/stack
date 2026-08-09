import { randomBytes } from "node:crypto";

const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_ROLE_CODE = "a".codePointAt(0) ?? 0;
const MAX_ROLE_CODE = "z".codePointAt(0) ?? 0;
const MIN_DIGIT_CODE = "0".codePointAt(0) ?? 0;
const MAX_DIGIT_CODE = "9".codePointAt(0) ?? 0;
const INVALID_RPC_URL = "Invalid --rpc-url: expected http(s) URL";

export type IckbChain = "mainnet" | "testnet";

export interface GenerateConfigArgs {
  chain: IckbChain;
  force: boolean;
  help?: true;
  maxIterations?: number;
  maxRetryableAttempts?: number;
  out: string;
  role: string;
  rpcUrl?: string;
  sleepIntervalSeconds: number;
}

export interface RuntimeConfigInput {
  chain: IckbChain;
  maxIterations?: number;
  maxRetryableAttempts?: number;
  privateKey: string;
  rpcUrl: string;
  sleepIntervalSeconds: number;
}

export type RuntimeConfig = RuntimeConfigInput;

export type RandomBytes = (size: number) => Buffer;

type ArgsPatch = Partial<GenerateConfigArgs>;
type ValueFlagParser = (value: string, flag: string) => ArgsPatch;

const valueFlagParsers: Partial<Record<string, ValueFlagParser>> = {
  "--chain": (value) => ({ chain: parseChain(value) }),
  "--role": (value) => ({ role: parseRole(value) }),
  "--out": (value) => ({ out: value }),
  "--rpc-url": (value) => ({ rpcUrl: parseRpcUrl(value) }),
  "--sleep-interval-seconds": (value, flag) => ({
    sleepIntervalSeconds: parsePositiveInteger(value, flag),
  }),
  "--max-iterations": (value, flag) => ({
    maxIterations: parsePositiveInteger(value, flag),
  }),
  "--max-retryable-attempts": (value, flag) => ({
    maxRetryableAttempts: parsePositiveInteger(value, flag),
  }),
};

const bareFlagPatches: Partial<Record<string, ArgsPatch>> = {
  "-h": { help: true },
  "--help": { help: true },
  "--force": { force: true },
  "--no-max-iterations": { maxIterations: undefined },
  "--no-max-retryable-attempts": { maxRetryableAttempts: undefined },
};

export function parseArgs(argv: readonly string[]): GenerateConfigArgs {
  let args = defaultArgs();
  let outProvided = false;
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    index += 1;
    if (arg === undefined || arg === "--") {
      continue;
    }
    const valueParser = valueFlagParsers[arg];
    if (valueParser !== undefined) {
      args = { ...args, ...valueParser(valueAfter(argv, index, arg), arg) };
      outProvided ||= arg === "--out";
      index += 1;
      continue;
    }
    const patch = bareFlagPatches[arg];
    if (patch === undefined) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    args = { ...args, ...patch };
  }

  if (!outProvided) {
    args = { ...args, out: `config/${args.role}-${args.chain}.json` };
  }
  if (args.help !== true && args.rpcUrl === undefined) {
    throw new Error("Missing required --rpc-url");
  }
  return args;
}

function defaultArgs(): GenerateConfigArgs {
  return {
    chain: "testnet",
    role: "bot",
    out: "config/bot-testnet.json",
    sleepIntervalSeconds: 60,
    maxIterations: 1,
    maxRetryableAttempts: 10,
    force: false,
  };
}

export function usage(): string {
  return [
    "Usage: node scripts/live/generate-config.ts --rpc-url <url> [--chain testnet|mainnet] [--role <label>] [--out <ignored-json-config>] [--sleep-interval-seconds <n>] [--max-iterations <n>|--no-max-iterations] [--max-retryable-attempts <n>|--no-max-retryable-attempts] [--force]",
    "Defaults: --chain testnet --role bot --out config/<role>-<chain>.json --sleep-interval-seconds 60 --max-iterations 1 --max-retryable-attempts 10",
  ].join("\n");
}

export function generateSecp256k1PrivateKey(
  readRandomBytes: RandomBytes = randomBytes,
): string {
  for (;;) {
    const candidate = readRandomBytes(32);
    if (candidate.length !== 32) {
      throw new Error("Random byte source must return exactly 32 bytes");
    }
    const hex = candidate.toString("hex");
    const value = BigInt(`0x${hex}`);
    if (value > 0n && value < SECP256K1_ORDER) {
      return `0x${hex}`;
    }
  }
}

export function buildRuntimeConfig({
  chain,
  privateKey,
  rpcUrl,
  sleepIntervalSeconds,
  maxIterations,
  maxRetryableAttempts,
}: RuntimeConfigInput): RuntimeConfig {
  return {
    chain,
    privateKey,
    rpcUrl,
    sleepIntervalSeconds,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxRetryableAttempts === undefined ? {} : { maxRetryableAttempts }),
  };
}

function valueAfter(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseChain(value: string): IckbChain {
  if (value !== "mainnet" && value !== "testnet") {
    throw new Error("Invalid --chain: expected mainnet or testnet");
  }
  return value;
}

function parseRole(value: string): string {
  if (!isValidRole(value)) {
    throw new Error(
      "Invalid --role: expected 1-32 lowercase letters, numbers, hyphens, or underscores without trailing separators",
    );
  }
  return value;
}

function isValidRole(value: string): boolean {
  const first = value.at(0);
  const last = value.at(-1);
  return (
    value.length > 0 &&
    value.length <= 32 &&
    first !== undefined &&
    last !== undefined &&
    isLowercaseLetter(first) &&
    !isRoleSeparator(last) &&
    hasOnlyRoleChars(value)
  );
}

function hasOnlyRoleChars(value: string): boolean {
  for (const char of value) {
    if (!isRoleChar(char)) {
      return false;
    }
  }
  return true;
}

function isRoleChar(char: string): boolean {
  return isLowercaseLetter(char) || isDigit(char) || isRoleSeparator(char);
}

function isRoleSeparator(char: string): boolean {
  return char === "-" || char === "_";
}

function isLowercaseLetter(char: string): boolean {
  const code = char.codePointAt(0);
  return code !== undefined && code >= MIN_ROLE_CODE && code <= MAX_ROLE_CODE;
}

function isDigit(char: string): boolean {
  const code = char.codePointAt(0);
  return code !== undefined && code >= MIN_DIGIT_CODE && code <= MAX_DIGIT_CODE;
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected a positive integer`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER) {
    throw new Error(`Invalid ${flag}: expected a safe integer`);
  }
  return Number(parsed);
}

function parseRpcUrl(value: string): string {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined || char.trim() === "" || code < 0x20 || code === 0x7f) {
      throw new Error(INVALID_RPC_URL);
    }
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(INVALID_RPC_URL);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(INVALID_RPC_URL);
  }
  return value;
}
