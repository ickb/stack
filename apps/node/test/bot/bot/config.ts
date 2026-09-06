import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBotRuntimeConfig } from "../../../src/bot/index.ts";

describe("readBotRuntimeConfig", () => {
  it("reads the BOT_ variables and key file", async () => {
    await expect(readBotRuntimeConfig({})).rejects.toThrow("Empty env BOT_CHAIN");

    const privateKey = `0x${"11".repeat(32)}`;
    const dir = await mkdtemp(path.join(tmpdir(), "ickb-bot-config-"));
    try {
      const keyPath = path.join(dir, "testnet.key");
      await writeFile(keyPath, `${privateKey}\n`, { mode: 0o600 });

      await expect(
        readBotRuntimeConfig({
          BOT_CHAIN: "testnet",
          BOT_RPC_URL: "http://127.0.0.1:8114/",
          BOT_PRIVATE_KEY_FILE: keyPath,
        }),
      ).resolves.toEqual({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
