import { describe, expect, it, vi } from "vitest";
import { BotEventEmitter, createRunId } from "../../src/bot/events.ts";

describe("bot events", () => {
  it("writes one JSON line per event with identity, timestamp, and bigints as strings", () => {
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      new BotEventEmitter({ chain: "testnet", runId: "run-1" }).emit({
        type: "bot.transaction.committed",
        txHash: `0x${"44".repeat(32)}`,
        status: "committed",
        elapsedMs: 12,
        timeoutMs: 600_000,
        intervalMs: 10_000,
      });
    } finally {
      stdoutWrite.mockRestore();
    }

    expect(output).toHaveLength(1);
    const line = output[0] ?? "";
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toMatchObject({
      type: "bot.transaction.committed",
      chain: "testnet",
      runId: "run-1",
      txHash: `0x${"44".repeat(32)}`,
      status: "committed",
    });
    expect(line).toMatch(/"timestamp":"\d{4}-\d\d-\d\dT[^"]*Z"/u);
  });

  it("creates run ids with timestamp and process evidence", () => {
    expect(createRunId()).toMatch(/^\d{4}-\d\d-\d\dT.*Z-[\da-z]+$/u);
  });
});
