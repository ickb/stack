import path from "node:path";
import process from "node:process";
import type { SupportedChain } from "../../../src/utils/chain.ts";

const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * Journaled endpoint identity: each configured endpoint's protocol, host and port, never
 * its path or query, where providers put API keys.
 */
export type PublicRpcEndpointIdentity =
  | {
      mode: "exclusive";
      endpoints: Array<{
        protocol: "http:" | "https:" | "ws:" | "wss:";
        hostname: string;
        port: string;
      }>;
    }
  | { mode: "default" };

/** Runtime configuration read from one prefix of environment variables. */
export interface RuntimeConfig {
  /** Public CKB chain expected by the app. */
  chain: SupportedChain;

  /** Secp256k1 private key used only for signing. */
  privateKey: `0x${string}`;

  /**
   * The configured nodes' RPC URLs in this process's shuffled order, the only endpoints
   * when set, tried in that order as CCC falls back on errors; absent means CCC's public pool.
   */
  rpcUrls?: [string, ...string[]];

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
  // Commas only: a space around a URL is refused like any whitespace in it. Each process
  // shuffles them: CCC's fallback moves on only after a transport error and then stays, so
  // a node that answers badly (an error body, a lagging tip) would otherwise fail every turn
  // of every restart from the same first URL.
  const [first = "", ...rest] = shuffled(rpcUrl.value.split(","));
  const rpcUrls: [string, ...string[]] = [first, ...rest];
  return {
    chain,
    privateKey,
    rpcUrls,
    rpcEndpoint: {
      mode: "exclusive",
      endpoints: rpcUrls.map((value) => parseRpcUrl({ name: rpcUrl.name, value })),
    },
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
function parseRpcUrl({
  name,
  value,
}: EnvValue): Extract<
  PublicRpcEndpointIdentity,
  { mode: "exclusive" }
>["endpoints"][number] {
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
