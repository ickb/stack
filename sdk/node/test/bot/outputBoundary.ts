import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleTurnFailure } from "../../src/bot/failure.ts";
import { BotEventEmitter, readBotRuntimeConfig } from "../../src/bot/index.ts";

describe("bot private key output boundary", () => {
  it("does not expose the configured key through failure events", async () => {
    const privateKey = `0x${"42".repeat(32)}`;
    const dir = await mkdtemp(path.join(tmpdir(), "ickb-bot-private-key-boundary-"));
    const output: string[] = [];
    try {
      const keyPath = path.join(dir, "testnet.key");
      await writeFile(keyPath, privateKey, { mode: 0o600 });
      const config = await readBotRuntimeConfig({
        BOT_CHAIN: "testnet",
        BOT_RPC_URL: "https://testnet.example/",
        BOT_PRIVATE_KEY_FILE: keyPath,
      });
      const emitter = new BotEventEmitter({
        chain: config.chain,
        runId: "run-canary-test",
        write: (event): void => {
          output.push(JSON.stringify(event));
        },
      });

      emitter.emit({ type: "bot.turn.started" });
      handleTurnFailure(emitter, new TypeError("fetch failed"));

      expect(config.privateKey).toBe(privateKey);
      expect(output.join("\n")).not.toContain(privateKey);
      for (const line of output) {
        expect(JSON.parse(line)).toMatchObject({
          chain: "testnet",
          runId: "run-canary-test",
        });
      }
    } finally {
      process.exitCode = undefined;
      vi.restoreAllMocks();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
