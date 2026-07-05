import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  parseRuntimeConfig,
  randomSleepIntervalMs,
  reachedMaxIterations,
  readRuntimeConfigEnv,
  type RuntimeConfig,
} from "../src/index.ts";
import { sequence } from "./support/node_utils_support.ts";

const VALID_PRIVATE_KEY = `0x${"11".repeat(32)}`;
const CONFIG_FILE_NAME = "config.json";
const CONFIG_ENV_NAME = "BOT_CONFIG_FILE";
const INVALID_CONFIG_ENV_ERROR = `Invalid env ${CONFIG_ENV_NAME}`;
const RUNTIME_CONFIG_TEST_DIR = path.join(
  import.meta.dirname,
  "../../../.scratch/node-utils-runtime-config",
);
const RUNTIME_CONFIG_FILE_PATH = path.join(RUNTIME_CONFIG_TEST_DIR, CONFIG_FILE_NAME);

describe("runtime config intervals", () => {
  it("parses positive sleep intervals as milliseconds", async () => {
    await expect(
      readRuntimeConfigText(runtimeConfigText({ sleepIntervalSeconds: 1 })),
    ).resolves.toMatchObject({ sleepIntervalMs: 1000 });
    await expect(
      readRuntimeConfigText(runtimeConfigText({ sleepIntervalSeconds: 2.5 })),
    ).resolves.toMatchObject({ sleepIntervalMs: 2500 });
    await expect(
      readRuntimeConfigText(runtimeConfigText({ sleepIntervalSeconds: 1073741 })),
    ).resolves.toMatchObject({ sleepIntervalMs: 1073741000 });
  });

  it("rejects missing and sub-second sleep intervals", async () => {
    for (const value of [undefined, NaN, Infinity, 0, 0.5, 1073741.824, 9007199254741]) {
      await expect(
        readRuntimeConfigText(runtimeConfigText({ sleepIntervalSeconds: value })),
      ).rejects.toThrow(INVALID_CONFIG_ENV_ERROR);
    }
  });

  it("parses bounded-run iteration limits", async () => {
    await expect(
      readRuntimeConfigText(runtimeConfigText({ maxIterations: undefined })),
    ).resolves.toMatchObject({ maxIterations: undefined });
    await expect(
      readRuntimeConfigText(runtimeConfigText({ maxIterations: 1 })),
    ).resolves.toMatchObject({ maxIterations: 1 });
    await expect(
      readRuntimeConfigText(runtimeConfigText({ maxIterations: 2 })),
    ).resolves.toMatchObject({ maxIterations: 2 });
    expect(reachedMaxIterations(0, 1)).toBe(false);
    expect(reachedMaxIterations(1, 1)).toBe(true);
    expect(reachedMaxIterations(10, undefined)).toBe(false);
    await expect(
      readRuntimeConfigText(runtimeConfigText({ maxIterations: 0 })),
    ).rejects.toThrow(INVALID_CONFIG_ENV_ERROR);
    await expect(
      readRuntimeConfigText(runtimeConfigText({ maxIterations: 1.5 })),
    ).rejects.toThrow(INVALID_CONFIG_ENV_ERROR);
  });

  it("randomizes sleep with triangular jitter centered on the interval", () => {
    expect(randomSleepIntervalMs(1000, sequence(0, 0))).toBe(0);
    expect(randomSleepIntervalMs(1000, sequence(0.5, 0.5))).toBe(1000);
    expect(randomSleepIntervalMs(1000, sequence(0.999, 0.999))).toBe(1998);
    expect(randomSleepIntervalMs(1000, sequence(0.5))).toBe(500);
    const samples = Array.from({ length: 1000 }, (_, index) => index / 1000);
    const average =
      samples.reduce(
        (sum, first) => sum + randomSleepIntervalMs(1000, sequence(first, 1 - first)),
        0,
      ) / samples.length;
    expect(average).toBe(1000);
    expect(
      randomSleepIntervalMs(1073741823, sequence(0.999999, 0.999999)),
    ).toBeLessThanOrEqual(2147483647);
  });
});

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
    expect(
      parseRuntimeConfig(runtimeConfigText({ sleepIntervalSeconds: 5 }), CONFIG_ENV_NAME),
    ).toMatchObject({ chain: "testnet", sleepIntervalMs: 5000 });

    await expect(
      readRuntimeConfigText(
        JSON.stringify({
          chain: "testnet",
          privateKey,
          rpcUrl: "https://rpc.example/path?token=abc",
          sleepIntervalSeconds: 60,
          maxIterations: 2,
        }),
      ),
    ).resolves.toEqual({
      chain: "testnet",
      privateKey,
      rpcUrl: "https://rpc.example/path?token=abc",
      sleepIntervalMs: 60000,
      maxIterations: 2,
      maxRetryableAttempts: undefined,
    });
    await expect(
      readRuntimeConfigText(
        runtimeConfigText({
          chain: "mainnet",
          rpcUrl: "https://mainnet.example/",
          sleepIntervalSeconds: 1,
        }),
      ),
    ).resolves.toMatchObject({
      chain: "mainnet",
      rpcUrl: "https://mainnet.example/",
      sleepIntervalMs: 1000,
    });
    await expect(
      readRuntimeConfigText(runtimeConfigText({ sleepIntervalSeconds: 5 })),
    ).resolves.toMatchObject({
      rpcUrl: undefined,
      sleepIntervalMs: 5000,
      maxRetryableAttempts: undefined,
    });
    await expect(
      readRuntimeConfigText(
        runtimeConfigText({ sleepIntervalSeconds: 5, maxRetryableAttempts: 3 }),
      ),
    ).resolves.toMatchObject({ maxRetryableAttempts: 3 });
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

describe("runtime config file path resolution", () => {
  it("uses the current working directory for relative config paths without INIT_CWD", async () => {
    const originalInitCwd = process.env["INIT_CWD"];
    const relativeConfigPath = path.relative(process.cwd(), RUNTIME_CONFIG_FILE_PATH);
    await writeRuntimeConfigFile(runtimeConfigText({ sleepIntervalSeconds: 5 }));
    try {
      delete process.env["INIT_CWD"];
      await expect(
        readRuntimeConfigEnv(relativeConfigPath, CONFIG_ENV_NAME),
      ).resolves.toMatchObject({
        chain: "testnet",
        sleepIntervalMs: 5000,
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
        sleepIntervalSeconds: 60,
      }),
    );
    try {
      await expect(
        readRuntimeConfigEnv(RUNTIME_CONFIG_FILE_PATH, CONFIG_ENV_NAME),
      ).resolves.toEqual({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
        sleepIntervalMs: 60000,
        maxIterations: undefined,
        maxRetryableAttempts: undefined,
      });
      await expect(readRuntimeConfigEnv(undefined, CONFIG_ENV_NAME)).rejects.toThrow(
        `Empty env ${CONFIG_ENV_NAME}`,
      );
      await expect(
        readRuntimeConfigEnv(path.join(RUNTIME_CONFIG_TEST_DIR, "missing"), CONFIG_ENV_NAME),
      ).rejects.toThrow(`Invalid file from env ${CONFIG_ENV_NAME}`);
      process.env["INIT_CWD"] = RUNTIME_CONFIG_TEST_DIR;
      await expect(
        readRuntimeConfigEnv(CONFIG_FILE_NAME, CONFIG_ENV_NAME),
      ).resolves.toMatchObject({
        chain: "testnet",
        privateKey,
      });
      await expect(
        readRuntimeConfigEnv(path.resolve(CONFIG_FILE_NAME), CONFIG_ENV_NAME),
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
    runtimeConfigText({ rpcUrl: "" }),
    runtimeConfigText({ rpcUrl: "file:///tmp/socket" }),
    runtimeConfigText({ rpcUrl: "https://[bad" }),
    runtimeConfigText({ rpcUrl: "https://rpc.example/ bad" }),
    runtimeConfigText({ rpcUrl: 8114 }),
    runtimeConfigText({ sleepIntervalSeconds: "60" }),
    runtimeConfigText({ sleepIntervalSeconds: 0 }),
    runtimeConfigText({ maxIterations: "1" }),
    runtimeConfigText({ maxRetryableAttempts: "1" }),
    runtimeConfigText({ maxRetryableAttempts: 0 }),
  ];
}

function runtimeConfigText(overrides: Record<string, unknown>): string {
  const config: Record<string, unknown> = {
    chain: "testnet",
    privateKey: VALID_PRIVATE_KEY,
    sleepIntervalSeconds: 60,
    ...overrides,
  };
  return JSON.stringify(
    Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)),
  );
}
