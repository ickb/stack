import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupportedChain } from "../../../src/constants.ts";

const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * Journaled endpoint identity: a configured endpoint's protocol, host and port, never its
 * path or query, where providers put API keys.
 */
export interface RpcEndpointIdentity {
  protocol: "http:" | "https:" | "ws:" | "wss:";
  hostname: string;
  port: string;
}

/** Runtime configuration read from one prefix of environment variables. */
export interface RuntimeConfig {
  /** Public CKB chain expected by the app. */
  chain: SupportedChain;

  /**
   * Secp256k1 private keys used only for signing, in key file order. The first is the
   * primary: its lock receives change and its CKB pays fees, and the turns move every other
   * key's cells to that lock.
   */
  privateKeys: [`0x${string}`, ...Array<`0x${string}`>];

  /**
   * The configured nodes' RPC URLs in this process's shuffled order, the only endpoints,
   * tried in that order as CCC falls back on errors.
   */
  rpcUrls: [string, ...string[]];

  /** What the journal may say about the endpoints, in the same order: never a URL, which may carry a token. */
  rpcEndpoints: RpcEndpointIdentity[];
}

/**
 * Reads and validates `<prefix>_CHAIN`, `<prefix>_RPC_URL`, and the private keys
 * held in the file named by `<prefix>_PRIVATE_KEY_FILE`, one per line, the primary first.
 *
 * @remarks
 * The key lives in a file rather than a variable so it never sits in a unit file, an
 * inherited environment, or `systemctl show` output. The path must be absolute: pnpm runs the
 * script from the package directory, so a relative one would name a different file depending
 * on how the actor was started. Errors name only the variable so
 * config values and signing material are not copied into logs.
 */
export async function readRuntimeConfigEnv(
  env: NodeJS.ProcessEnv,
  prefix: string,
): Promise<RuntimeConfig> {
  const chain = parseSupportedChain(requireEnv(env, `${prefix}_CHAIN`));
  const rpcUrl = requireEnv(env, `${prefix}_RPC_URL`);
  const keyFile = requireEnv(env, `${prefix}_PRIVATE_KEY_FILE`);
  const keyText = await readFileEnv(keyFile);
  // One key per line, the primary first; split never returns an empty list. Keys are
  // canonical lowercase hex, so equal strings are the only equal keys: a repeated one would
  // sign its group twice, the second signature over the first, and every send would fail.
  const [firstLine = "", ...otherLines] = keyText.value.split("\n");
  const parse = (line: string): `0x${string}` =>
    parsePrivateKey({ name: keyText.name, value: line.trim() });
  const privateKeys: RuntimeConfig["privateKeys"] = [
    parse(firstLine),
    ...otherLines.map(parse),
  ];
  if (new Set(privateKeys).size !== privateKeys.length) {
    throw invalidEnvError(keyFile.name);
  }
  // Commas only: a space around a URL is refused like any whitespace in it. Each process
  // shuffles them: CCC's fallback moves on only after a transport error and then stays, so
  // a node that answers badly (an error body, a lagging tip) would otherwise fail every turn
  // of every restart from the same first URL.
  const [first = "", ...rest] = shuffled(rpcUrl.value.split(","));
  const rpcUrls: [string, ...string[]] = [first, ...rest];
  return {
    chain,
    privateKeys,
    rpcUrls,
    rpcEndpoints: rpcUrls.map((value) => parseRpcUrl({ name: rpcUrl.name, value })),
  };
}

/** A uniform random order: each value sorted by its own random key. */
function shuffled(values: string[]): string[] {
  return (
    values
      // eslint-disable-next-line sonarjs/pseudo-random -- the order only spreads failures across restarts; nothing needs it unpredictable.
      .map((value) => ({ value, key: Math.random() }))
      .toSorted((left, right) => left.key - right.key)
      .map(({ value }) => value)
  );
}

interface EnvValue {
  name: string;
  value: string;
}

/** The variable's value, or undefined when it is unset or empty: one rule for every optional setting. */
export function optionalEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === "" ? undefined : value;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): EnvValue {
  const value = optionalEnv(env, name);
  if (value === undefined) {
    throw new Error(`Empty env ${name}`);
  }
  return { name, value };
}

async function readFileEnv({ name, value }: EnvValue): Promise<EnvValue> {
  if (!path.isAbsolute(value)) {
    throw invalidEnvError(name);
  }
  let fileSecret: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the operator's configured key file.
    fileSecret = await readFile(value, "utf8");
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
function parseRpcUrl({ name, value }: EnvValue): RpcEndpointIdentity {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidEnvError(name);
  }
  const { protocol } = url;
  if (
    (protocol !== "http:" &&
      protocol !== "https:" &&
      protocol !== "ws:" &&
      protocol !== "wss:") ||
    // Userinfo would travel in every request and in the transport's error text; the
    // URL parser strips control characters silently, so they are refused here too.
    url.username !== "" ||
    url.password !== "" ||
    /[\s\p{Cc}]/u.test(value)
  ) {
    throw invalidEnvError(name);
  }
  return { protocol, hostname: url.hostname, port: url.port };
}

function isPrivateKeyHex(value: string): value is `0x${string}` {
  return /^0x[\da-f]{64}$/u.test(value);
}

function invalidEnvError(name: string): Error {
  return new Error(`Invalid env ${name}`);
}
