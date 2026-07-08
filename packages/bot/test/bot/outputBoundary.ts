import { handleLoopError, logExecution } from "@ickb/node-utils";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  isRetryableBotError,
  iterationFailureEventFields,
  readBotRuntimeConfig,
} from "../../src/index.ts";
import { BotEventEmitter } from "../../src/observability/events.ts";
import { transactionLifecycleEvents } from "../../src/observability/lifecycle.ts";
import { hash } from "./fixtures/bot.ts";

type BotRuntimeConfig = Awaited<ReturnType<typeof readBotRuntimeConfig>>;

const CONFIG_FILE_NAME = "config.json";
const FETCH_FAILED = "fetch failed";

describe("bot private key output boundary", () => {
  it("does not leak the configured canary key across representative crash outputs", async () => {
    const privateKey = `0x${"42".repeat(32)}`;
    const dir = await mkdtemp(path.join(tmpdir(), "ickb-bot-private-key-boundary-"));
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      const runtimeConfig = await readPrivateKeyBoundaryRuntimeConfig(dir, privateKey);
      emitRepresentativeCrashOutputs(runtimeConfig, output);

      expect(runtimeConfig.privateKey).toBe(privateKey);
      expect(output.join("\n")).not.toContain(privateKey);
    } finally {
      stdoutWrite.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function readPrivateKeyBoundaryRuntimeConfig(
  dir: string,
  privateKey: string,
): Promise<BotRuntimeConfig> {
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
  return readBotRuntimeConfig({ BOT_CONFIG_FILE: configPath });
}

function emitRepresentativeCrashOutputs(
  runtimeConfig: BotRuntimeConfig,
  output: string[],
): void {
  const emitter = new BotEventEmitter({
    chain: runtimeConfig.chain,
    runId: "run-canary-test",
    write: (event): void => {
      output.push(JSON.stringify(event));
    },
  });
  emitter.emit(0, "bot.run.started", {
    runtime: {
      maxIterations: runtimeConfig.maxIterations,
      maxRetryableAttempts: runtimeConfig.maxRetryableAttempts,
      bounded: runtimeConfig.maxIterations !== undefined,
      sleepIntervalMs: runtimeConfig.sleepIntervalMs,
      rpcConfigured: runtimeConfig.rpcUrl !== undefined,
    },
  });
  emitter.emit(0, "bot.chain.preflight", {
    rpcConfigured: runtimeConfig.rpcUrl !== undefined,
    expected: { chain: "testnet", genesisHash: hash("11"), addressPrefix: "ckt" },
    observed: {
      genesisHash: hash("11"),
      addressPrefix: "ckt",
      tip: { hash: hash("22"), number: 1n, timestamp: 2n },
    },
    matches: { genesisHash: true, addressPrefix: true },
  });
  const executionLog: Record<string, unknown> = { startTime: "fixture" };
  handleLoopError(executionLog, new Error("deterministic crash"));
  logExecution(executionLog, new Date());
  emitter.emit(
    1,
    "bot.iteration.failed",
    iterationFailureEventFields(new TypeError(FETCH_FAILED)),
  );
  for (const lifecycle of transactionLifecycleEvents(
    { type: "pre_broadcast_failed", elapsedMs: 1, error: new TypeError(FETCH_FAILED) },
    isRetryableBotError,
  )) {
    emitter.emit(1, lifecycle.type, lifecycle.fields);
  }
}
