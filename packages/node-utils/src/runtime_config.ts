import path from "node:path";
import process from "node:process";
import type { SupportedChain } from "./chain.ts";

const { isAbsolute, resolve: resolvePath } = path;
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const INVALID_ENV_MESSAGE = "Invalid env ";
const CHAIN_KEY = "chain";
const PRIVATE_KEY_KEY = "privateKey";
const RPC_URL_KEY = "rpcUrl";
const RUNTIME_CONFIG_KEYS = new Set([CHAIN_KEY, PRIVATE_KEY_KEY, RPC_URL_KEY]);

/** Runtime configuration loaded from a secret-backed JSON file. */
export interface RuntimeConfig {
  /** Public CKB chain expected by the app. */
  chain: SupportedChain;

  /** Secp256k1 private key used only for signing. */
  privateKey: `0x${string}`;

  /** Exclusive RPC URL for the selected public chain. */
  rpcUrl: string;
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

async function readFileEnv(fileEnvValue: string, fileEnvName: string): Promise<string> {
  const secretPath = isAbsolute(fileEnvValue)
    ? fileEnvValue
    : resolvePath(process.env["INIT_CWD"] ?? process.cwd(), fileEnvValue);
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
  const rpcUrl = parseRpcUrl(parseRequiredString(record[RPC_URL_KEY], envName), envName);

  return { chain, privateKey: parsePrivateKey(privateKey, envName), rpcUrl };
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

function parseRequiredString(value: unknown, envName: string): string {
  if (typeof value !== "string") {
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
  if (url.username !== "" || url.password !== "") {
    throw invalidEnvError(envName);
  }
  return rpcUrl;
}

function isPrivateKeyHex(value: string): value is `0x${string}` {
  return /^0x[\da-f]{64}$/u.test(value);
}

function invalidEnvError(envName: string): Error {
  return new Error(INVALID_ENV_MESSAGE + envName);
}
