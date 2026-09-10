import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRuntimeConfigEnv, type RuntimeConfig } from "../../src/shared/index.ts";

const VALID_PRIVATE_KEY = `0x${"11".repeat(32)}`;
const SECP256K1_ORDER =
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";
const RPC_URL = "https://testnet.example/";
const KEY_FILE_NAME = "testnet.key";
const KEY_DIR = path.join(
  import.meta.dirname,
  "../../../.scratch/node-utils-runtime-config",
);
const KEY_FILE_PATH = path.join(KEY_DIR, KEY_FILE_NAME);

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
    });
    await expect(
      readConfig({
        BOT_CHAIN: "mainnet",
        BOT_RPC_URL: "https://rpc.example/path?token=abc",
      }),
    ).resolves.toEqual({
      chain: "mainnet",
      privateKey: VALID_PRIVATE_KEY,
      rpcUrl: "https://rpc.example/path?token=abc",
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
    await expect(readConfig({ BOT_RPC_URL: "" })).rejects.toThrow(
      "Empty env BOT_RPC_URL",
    );
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
  it("rejects malformed, non-HTTP, and credential-bearing URLs without exposing them", async () => {
    await writeKeyFile(VALID_PRIVATE_KEY);
    for (const rpcUrl of [
      "file:///tmp/socket",
      "https://[bad",
      "https://rpc.example/ bad",
      "https://rpc.example/",
      "https://user@rpc.example/",
      "https://:password@rpc.example/",
      "https://user:password@rpc.example/",
      "https://%75ser:%70assword@rpc.example/",
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
  await mkdir(KEY_DIR, { recursive: true, mode: 0o700 });
  await writeFile(KEY_FILE_PATH, text, { mode: 0o600 });
}
