import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBotRuntimeConfig } from "../../src/index.ts";

const CONFIG_FILE_NAME = "config.json";

describe("readBotRuntimeConfig", () => {
  it("requires a JSON config file", async () => {
    await expect(readBotRuntimeConfig({})).rejects.toThrow("Empty env BOT_CONFIG_FILE");
  });

  it("reads JSON config files", async () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const dir = await mkdtemp(path.join(tmpdir(), "ickb-bot-config-"));
    try {
      const configPath = path.join(dir, CONFIG_FILE_NAME);
      await writeFile(
        configPath,
        JSON.stringify({
          chain: "testnet",
          privateKey,
          rpcUrl: "http://127.0.0.1:8114/",
          sleepIntervalSeconds: 60,
          maxIterations: 1,
          maxRetryableAttempts: 3,
        }),
        { mode: 0o600 },
      );

      await expect(
        readBotRuntimeConfig({ BOT_CONFIG_FILE: configPath }),
      ).resolves.toEqual({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
        sleepIntervalMs: 60000,
        maxIterations: 1,
        maxRetryableAttempts: 3,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads JSON config files that omit custom RPC URLs", async () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const dir = await mkdtemp(path.join(tmpdir(), "ickb-bot-config-"));
    try {
      const configPath = path.join(dir, CONFIG_FILE_NAME);
      await writeFile(
        configPath,
        JSON.stringify({
          chain: "testnet",
          privateKey,
          sleepIntervalSeconds: 60,
          maxIterations: 1,
        }),
        { mode: 0o600 },
      );

      await expect(
        readBotRuntimeConfig({ BOT_CONFIG_FILE: configPath }),
      ).resolves.toEqual({
        chain: "testnet",
        privateKey,
        rpcUrl: undefined,
        sleepIntervalMs: 60000,
        maxIterations: 1,
        maxRetryableAttempts: undefined,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
