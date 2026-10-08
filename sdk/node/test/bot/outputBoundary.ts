import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BotEventEmitter } from "../../src/bot/events.ts";
import { readRuntimeConfigEnv } from "../../src/shared/runtime_config.ts";

describe("bot private key output boundary", () => {
  it("does not expose the configured key or the RPC URL through events", async () => {
    const privateKey = `0x${"42".repeat(32)}`;
    const dir = await mkdtemp(path.join(tmpdir(), "ickb-bot-private-key-boundary-"));
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      const keyPath = path.join(dir, "testnet.key");
      await writeFile(keyPath, privateKey, { mode: 0o600 });
      const config = await readRuntimeConfigEnv(
        {
          BOT_CHAIN: "testnet",
          BOT_RPC_URL: "https://testnet.example/?token=canary",
          BOT_PRIVATE_KEY_FILE: keyPath,
        },
        "BOT",
      );
      const emitter = new BotEventEmitter({
        chain: config.chain,
        runId: "run-canary-test",
      });

      emitter.emit({ type: "bot.turn.started" });
      emitter.emit({ type: "bot.turn.failed", error: new TypeError("fetch failed") });

      expect(config.privateKey).toBe(privateKey);
      expect(config.rpcEndpoint).toEqual({
        mode: "exclusive",
        protocol: "https:",
        hostname: "testnet.example",
        port: "",
        pathname: "/",
      });
      expect(output.join("")).not.toContain(privateKey);
      expect(output.join("")).not.toContain("token=canary");
      for (const line of output) {
        expect(JSON.parse(line)).toMatchObject({
          chain: "testnet",
          runId: "run-canary-test",
        });
      }
    } finally {
      stdoutWrite.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
