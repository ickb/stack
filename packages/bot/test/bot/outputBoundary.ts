import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleTurnFailure } from "../../src/bot/failure.ts";
import { BotEventEmitter, readBotRuntimeConfig } from "../../src/index.ts";

describe("bot private key output boundary", () => {
  it("does not expose the configured key through failure events", async () => {
    const privateKey = `0x${"42".repeat(32)}`;
    const dir = await mkdtemp(path.join(tmpdir(), "ickb-bot-private-key-boundary-"));
    const output: string[] = [];
    try {
      const configPath = path.join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          chain: "testnet",
          privateKey,
          rpcUrl: "https://testnet.example/",
        }),
        { mode: 0o600 },
      );
      const config = await readBotRuntimeConfig({ BOT_CONFIG_FILE: configPath });
      const emitter = new BotEventEmitter({
        chain: config.chain,
        runId: "run-canary-test",
        write: (event): void => {
          output.push(JSON.stringify(event));
        },
      });

      emitter.emit("bot.run.started");
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
