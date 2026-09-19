import path from "node:path";
import process from "node:process";
import type { SupportedChain } from "../../../src/utils/chain.ts";

const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** Credential-free identity of the RPC endpoint: one configured node, or CCC's public pool. */
export type PublicRpcEndpointIdentity =
  | {
      mode: "exclusive";
      protocol: "http:" | "https:" | "ws:" | "wss:";
      hostname: string;
      port: string;
      pathname: string;
    }
  | { mode: "default" };

/** Runtime configuration read from one prefix of environment variables. */
export interface RuntimeConfig {
  /** Public CKB chain expected by the app. */
  chain: SupportedChain;

  /** Secp256k1 private key used only for signing. */
  privateKey: `0x${string}`;

  /** RPC URL of one node, the only endpoint when set; absent means CCC's public pool. */
  rpcUrl?: string;

  /** What the journal may say about the endpoint: never the URL, which may carry a token. */
  rpcEndpoint: PublicRpcEndpointIdentity;
}

/**
 * Reads and validates `<prefix>_CHAIN`, the optional `<prefix>_RPC_URL`, and the private key
 * held in the file named by `<prefix>_PRIVATE_KEY_FILE`.
 *
 * @remarks
 * The key lives in a file rather than a variable so it never sits in a unit file, an
 * inherited environment, or `systemctl show` output. A relative file path resolves against
 * `INIT_CWD` when present, otherwise `process.cwd()`. Errors name only the variable so
 * config values and signing material are not copied into logs.
 */
export async function readRuntimeConfigEnv(
  env: NodeJS.ProcessEnv,
  prefix: string,
): Promise<RuntimeConfig> {
  const chain = parseSupportedChain(requireEnv(env, `${prefix}_CHAIN`));
  const rpcUrl = optionalEnv(env, `${prefix}_RPC_URL`);
  const keyFile = requireEnv(env, `${prefix}_PRIVATE_KEY_FILE`);
  const privateKey = parsePrivateKey(await readFileEnv(env, keyFile));
  if (rpcUrl === undefined) {
    return { chain, privateKey, rpcEndpoint: { mode: "default" } };
  }
  return { chain, privateKey, rpcUrl: rpcUrl.value, rpcEndpoint: parseRpcUrl(rpcUrl) };
}

interface EnvValue {
  name: string;
  value: string;
}

function optionalEnv(env: NodeJS.ProcessEnv, name: string): EnvValue | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : { name, value };
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): EnvValue {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`Empty env ${name}`);
  }
  return { name, value };
}

async function readFileEnv(
  env: NodeJS.ProcessEnv,
  { name, value }: EnvValue,
): Promise<EnvValue> {
  const secretPath = path.isAbsolute(value)
    ? value
    : path.resolve(env["INIT_CWD"] ?? process.cwd(), value);
  let fileSecret: string;
  try {
    const fileSystem = await import("node:fs/promises");
    fileSecret = await fileSystem.readFile(secretPath, "utf8");
  } catch (cause) {
    throw new Error(`Invalid file from env ${name}`, { cause });
  }
  // Editors end the file with a newline; the key itself still has to be exact.
  return { name, value: fileSecret.trim() };
}

function parseSupportedChain({ name, value }: EnvValue): SupportedChain {
  if (value !== "mainnet" && value !== "testnet") {
    throw invalidEnvError(name);
  }
  return value;
}

function parsePrivateKey({ name, value }: EnvValue): `0x${string}` {
  if (isPrivateKeyHex(value)) {
    const key = BigInt(value);
    if (key > 0n && key < SECP256K1_ORDER) {
      return value;
    }
  }
  throw invalidEnvError(name);
}

/** The URL string reaches only the client; the journal gets these fields, never the URL. */
function parseRpcUrl({ name, value }: EnvValue): PublicRpcEndpointIdentity {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidEnvError(name);
  }
  const { protocol } = url;
  if (
    protocol !== "http:" &&
    protocol !== "https:" &&
    protocol !== "ws:" &&
    protocol !== "wss:"
  ) {
    throw invalidEnvError(name);
  }
  return {
    mode: "exclusive",
    protocol,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
  };
}

function isPrivateKeyHex(value: string): value is `0x${string}` {
  return /^0x[\da-f]{64}$/u.test(value);
}

function invalidEnvError(name: string): Error {
  return new Error(`Invalid env ${name}`);
}
