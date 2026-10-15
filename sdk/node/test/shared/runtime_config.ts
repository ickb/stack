import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readRuntimeConfigEnv,
  type RuntimeConfig,
} from "../../src/shared/runtime_config.ts";

const VALID_PRIVATE_KEY = `0x${"11".repeat(32)}`;
const SECP256K1_ORDER =
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";
const RPC_URL = "https://testnet.example/";
const KEY_FILE_NAME = "testnet.key";
// A private temporary directory per test, outside the checkout.
let KEY_DIR = "";
let KEY_FILE_PATH = "";

beforeEach(async () => {
  KEY_DIR = await mkdtemp(path.join(tmpdir(), "ickb-runtime-config-"));
  KEY_FILE_PATH = path.join(KEY_DIR, KEY_FILE_NAME);
});

afterEach(async () => {
  await rm(KEY_DIR, { recursive: true, force: true });
});

describe("runtime config env", () => {
  it("reads chain and RPC URL from env and the key from the named file", async () => {
    await writeKeyFile(VALID_PRIVATE_KEY);

    await expect(readConfig({})).resolves.toEqual({
      chain: "testnet",
      privateKey: VALID_PRIVATE_KEY,
      rpcUrl: RPC_URL,
      rpcEndpoint: {
        mode: "exclusive",
        protocol: "https:",
        hostname: "testnet.example",
        port: "",
        pathname: "/",
      },
    });
    // The URL string reaches only the client; its identity carries no query.
    await expect(
      readConfig({
        BOT_CHAIN: "mainnet",
        BOT_RPC_URL: "https://rpc.example:8443/path?token=abc#private",
      }),
    ).resolves.toEqual({
      chain: "mainnet",
      privateKey: VALID_PRIVATE_KEY,
      rpcUrl: "https://rpc.example:8443/path?token=abc#private",
      rpcEndpoint: {
        mode: "exclusive",
        protocol: "https:",
        hostname: "rpc.example",
        port: "8443",
        pathname: "/path",
      },
    });
  });

  it("uses the prefix to select the variables", async () => {
    await writeKeyFile(VALID_PRIVATE_KEY);

    await expect(
      readRuntimeConfigEnv(
        {
          STIMULUS_CHAIN: "testnet",
          STIMULUS_RPC_URL: RPC_URL,
          STIMULUS_PRIVATE_KEY_FILE: KEY_FILE_PATH,
        },
        "STIMULUS",
      ),
    ).resolves.toMatchObject({ chain: "testnet" });
    await expect(readConfig({ BOT_CHAIN: undefined })).rejects.toThrow(
      "Empty env BOT_CHAIN",
    );
    // No RPC URL means CCC's public pool.
    await expect(readConfig({ BOT_RPC_URL: "" })).resolves.toEqual({
      chain: "testnet",
      privateKey: VALID_PRIVATE_KEY,
      rpcEndpoint: { mode: "default" },
    });
    await expect(readConfig({ BOT_PRIVATE_KEY_FILE: undefined })).rejects.toThrow(
      "Empty env BOT_PRIVATE_KEY_FILE",
    );
  });

  it("resolves relative key paths against INIT_CWD, then the working directory", async () => {
    await writeKeyFile(VALID_PRIVATE_KEY);

    await expect(
      readConfig({ BOT_PRIVATE_KEY_FILE: KEY_FILE_NAME, INIT_CWD: KEY_DIR }),
    ).resolves.toMatchObject({ privateKey: VALID_PRIVATE_KEY });
    await expect(
      readConfig({ BOT_PRIVATE_KEY_FILE: path.relative(process.cwd(), KEY_FILE_PATH) }),
    ).resolves.toMatchObject({ privateKey: VALID_PRIVATE_KEY });
    await expect(readConfig({ BOT_PRIVATE_KEY_FILE: KEY_FILE_NAME })).rejects.toThrow(
      "Invalid file from env BOT_PRIVATE_KEY_FILE",
    );
  });
});

describe("runtime config private key file", () => {
  it("accepts an exact lowercase key with surrounding whitespace from editors", async () => {
    for (const text of [
      VALID_PRIVATE_KEY,
      `${VALID_PRIVATE_KEY}\n`,
      ` ${VALID_PRIVATE_KEY}\r\n`,
    ]) {
      await writeKeyFile(text);
      await expect(readConfig({})).resolves.toMatchObject({
        privateKey: VALID_PRIVATE_KEY,
      });
    }
  });

  it("rejects non-canonical or out-of-range keys without exposing them", async () => {
    for (const text of [
      "",
      "11".repeat(32),
      `0X${"11".repeat(32)}`,
      `0x${"AA".repeat(32)}`,
      `0x${"11".repeat(31)}`,
      `0x${"00".repeat(32)}`,
      SECP256K1_ORDER,
      "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364142",
      `${VALID_PRIVATE_KEY}\n${VALID_PRIVATE_KEY}`,
    ]) {
      await writeKeyFile(text);
      await expect(readConfig({})).rejects.toThrow(
        expect.objectContaining({ message: "Invalid env BOT_PRIVATE_KEY_FILE" }),
      );
    }
  });
});

describe("runtime config RPC URL", () => {
  it("rejects malformed, non-HTTP, credentialed and whitespace URLs without exposing them", async () => {
    await writeKeyFile(VALID_PRIVATE_KEY);
    for (const rpcUrl of [
      "file:///tmp/socket",
      "https://[bad",
      "not a url",
      "https://user:password@rpc.example/",
      "https://user@rpc.example/",
      "https://rpc.example/\t",
      " https://rpc.example/",
    ]) {
      let error: unknown;
      try {
        await readConfig({ BOT_RPC_URL: rpcUrl });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ message: "Invalid env BOT_RPC_URL" });
      expect(error instanceof Error ? error.message : String(error)).not.toContain(
        "rpc.example",
      );
    }
    await expect(readConfig({ BOT_CHAIN: "devnet" })).rejects.toThrow(
      "Invalid env BOT_CHAIN",
    );
  });
});

async function readConfig(overrides: NodeJS.ProcessEnv): Promise<RuntimeConfig> {
  return readRuntimeConfigEnv(
    {
      BOT_CHAIN: "testnet",
      BOT_RPC_URL: RPC_URL,
      BOT_PRIVATE_KEY_FILE: KEY_FILE_PATH,
      ...overrides,
    },
    "BOT",
  );
}

async function writeKeyFile(text: string): Promise<void> {
  await writeFile(KEY_FILE_PATH, text, { mode: 0o600 });
}
