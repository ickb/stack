import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  parseRuntimeConfig,
  readRuntimeConfigEnv,
  type RuntimeConfig,
} from "../src/index.ts";

const VALID_PRIVATE_KEY = `0x${"11".repeat(32)}`;
const CONFIG_FILE_NAME = "config.json";
const CONFIG_ENV_NAME = "BOT_CONFIG_FILE";
const INVALID_CONFIG_ENV_ERROR = `Invalid env ${CONFIG_ENV_NAME}`;
const { join, resolve } = path;
const RUNTIME_CONFIG_TEST_DIR = join(
  import.meta.dirname,
  "../../../.scratch/node-utils-runtime-config",
);
const RUNTIME_CONFIG_FILE_PATH = join(RUNTIME_CONFIG_TEST_DIR, CONFIG_FILE_NAME);

describe("runtime config JSON", () => {
  it("parses private keys as exact 0x-prefixed lowercase hex", async () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const secp256k1Order =
      "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";

    await expect(
      readRuntimeConfigText(runtimeConfigText({ privateKey })),
    ).resolves.toMatchObject({
      privateKey,
    });
    for (const value of [
      "11".repeat(32),
      `0X${"11".repeat(32)}`,
      `0x${"AA".repeat(32)}`,
      ` 0x${"11".repeat(32)}`,
      `0x${"11".repeat(32)} `,
      `0x${"11".repeat(31)}`,
      `0x${"00".repeat(32)}`,
      secp256k1Order,
      "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364142",
    ]) {
      await expect(
        readRuntimeConfigText(runtimeConfigText({ privateKey: value })),
      ).rejects.toThrow(INVALID_CONFIG_ENV_ERROR);
    }
  });
});

describe("runtime config JSON shape", () => {
  it("parses exact runtime JSON config", async () => {
    const privateKey = `0x${"11".repeat(32)}`;
    expect(parseRuntimeConfig(runtimeConfigText({}), CONFIG_ENV_NAME)).toEqual({
      chain: "testnet",
      privateKey,
      rpcUrl: "https://testnet.example/",
    });

    await expect(
      readRuntimeConfigText(
        JSON.stringify({
          chain: "testnet",
          privateKey,
          rpcUrl: "https://rpc.example/path?token=abc",
        }),
      ),
    ).resolves.toEqual({
      chain: "testnet",
      privateKey,
      rpcUrl: "https://rpc.example/path?token=abc",
    });
    await expect(
      readRuntimeConfigText(
        runtimeConfigText({ chain: "mainnet", rpcUrl: "https://mainnet.example/" }),
      ),
    ).resolves.toEqual({
      chain: "mainnet",
      privateKey,
      rpcUrl: "https://mainnet.example/",
    });
  });

  it("rejects invalid runtime JSON config without exposing contents", async () => {
    for (const value of invalidRuntimeConfigTexts()) {
      let error: unknown;
      try {
        await readRuntimeConfigText(value);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ message: INVALID_CONFIG_ENV_ERROR });
      expect(error instanceof Error ? error.message : String(error)).not.toMatch(
        /rpc\.example|0x11/u,
      );
    }
  });

  it("rejects non-object JSON object members without exposing contents", async () => {
    await expect(readRuntimeConfigText("null")).rejects.toThrow(INVALID_CONFIG_ENV_ERROR);
  });
});

describe("runtime config RPC URL", () => {
  it("rejects userinfo without exposing credential-bearing URLs", () => {
    const urls = [
      "https://user@rpc.example/",
      "https://:password@rpc.example/",
      "https://user:password@rpc.example/",
      "https://%75ser:%70assword@rpc.example/",
    ];

    for (const rpcUrl of urls) {
      let error: unknown;
      try {
        parseRuntimeConfig(runtimeConfigText({ rpcUrl }), CONFIG_ENV_NAME);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ message: INVALID_CONFIG_ENV_ERROR });
      expect(error instanceof Error ? error.message : String(error)).not.toContain(
        rpcUrl,
      );
    }
  });
});

describe("runtime config file path resolution", () => {
  it("uses the current working directory for relative config paths without INIT_CWD", async () => {
    const originalInitCwd = process.env["INIT_CWD"];
    const relativeConfigPath = path.relative(process.cwd(), RUNTIME_CONFIG_FILE_PATH);
    await writeRuntimeConfigFile(runtimeConfigText({}));
    try {
      delete process.env["INIT_CWD"];
      await expect(
        readRuntimeConfigEnv(relativeConfigPath, CONFIG_ENV_NAME),
      ).resolves.toMatchObject({
        chain: "testnet",
      });
    } finally {
      if (originalInitCwd === undefined) {
        delete process.env["INIT_CWD"];
      } else {
        process.env["INIT_CWD"] = originalInitCwd;
      }
      await rm(RUNTIME_CONFIG_TEST_DIR, { recursive: true, force: true });
    }
  });
});

describe("runtime config file env", () => {
  it("reads runtime JSON config from a file env source", async () => {
    const privateKey = VALID_PRIVATE_KEY;
    const originalInitCwd = process.env["INIT_CWD"];
    await writeRuntimeConfigFile(
      JSON.stringify({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
      }),
    );
    try {
      await expect(
        readRuntimeConfigEnv(RUNTIME_CONFIG_FILE_PATH, CONFIG_ENV_NAME),
      ).resolves.toEqual({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
      });
      await expect(readRuntimeConfigEnv(undefined, CONFIG_ENV_NAME)).rejects.toThrow(
        `Empty env ${CONFIG_ENV_NAME}`,
      );
      await expect(
        readRuntimeConfigEnv(join(RUNTIME_CONFIG_TEST_DIR, "missing"), CONFIG_ENV_NAME),
      ).rejects.toThrow(`Invalid file from env ${CONFIG_ENV_NAME}`);
      process.env["INIT_CWD"] = RUNTIME_CONFIG_TEST_DIR;
      await expect(
        readRuntimeConfigEnv(CONFIG_FILE_NAME, CONFIG_ENV_NAME),
      ).resolves.toMatchObject({
        chain: "testnet",
        privateKey,
      });
      await expect(
        readRuntimeConfigEnv(resolve(CONFIG_FILE_NAME), CONFIG_ENV_NAME),
      ).rejects.toThrow(`Invalid file from env ${CONFIG_ENV_NAME}`);
      await writeRuntimeConfigFile("");
      await expect(
        readRuntimeConfigEnv(RUNTIME_CONFIG_FILE_PATH, CONFIG_ENV_NAME),
      ).rejects.toThrow(`Empty file from env ${CONFIG_ENV_NAME}`);
    } finally {
      if (originalInitCwd === undefined) {
        delete process.env["INIT_CWD"];
      } else {
        process.env["INIT_CWD"] = originalInitCwd;
      }
      await rm(RUNTIME_CONFIG_TEST_DIR, { recursive: true, force: true });
    }
  });
});

async function readRuntimeConfigText(configText: string): Promise<RuntimeConfig> {
  await writeRuntimeConfigFile(configText);
  try {
    return await readRuntimeConfigEnv(RUNTIME_CONFIG_FILE_PATH, CONFIG_ENV_NAME);
  } finally {
    await rm(RUNTIME_CONFIG_TEST_DIR, { recursive: true, force: true });
  }
}

async function writeRuntimeConfigFile(configText: string): Promise<void> {
  await rm(RUNTIME_CONFIG_TEST_DIR, { recursive: true, force: true });
  await mkdir(RUNTIME_CONFIG_TEST_DIR, { recursive: true, mode: 0o700 });
  await writeFile(RUNTIME_CONFIG_FILE_PATH, configText, { mode: 0o600 });
}

function invalidRuntimeConfigTexts(): string[] {
  return [
    "not-json",
    JSON.stringify([]),
    runtimeConfigText({ chain: "devnet" }),
    runtimeConfigText({ chain: VALID_PRIVATE_KEY, rpcUrl: "https://rpc.example/" }),
    runtimeConfigText({ extra: true }),
    runtimeConfigText({ privateKey: 1 }),
    runtimeConfigText({ privateKey: `${VALID_PRIVATE_KEY}\n` }),
    runtimeConfigText({ rpcUrl: undefined }),
    runtimeConfigText({ rpcUrl: "" }),
    runtimeConfigText({ rpcUrl: "file:///tmp/socket" }),
    runtimeConfigText({ rpcUrl: "https://[bad" }),
    runtimeConfigText({ rpcUrl: "https://rpc.example/ bad" }),
    runtimeConfigText({ rpcUrl: 8114 }),
  ];
}

function runtimeConfigText(overrides: Record<string, unknown>): string {
  const config: Record<string, unknown> = {
    chain: "testnet",
    privateKey: VALID_PRIVATE_KEY,
    rpcUrl: "https://testnet.example/",
    ...overrides,
  };
  return JSON.stringify(
    Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)),
  );
}
