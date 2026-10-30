import { describe, expect, it, vi } from "vitest";
import { BotEventEmitter, createProcessId } from "../../src/bot/events.ts";

describe("bot events", () => {
  it("writes one JSON line per event with identity, timestamp, and bigints as strings", () => {
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      new BotEventEmitter({ chain: "testnet", processId: "run" }).emit({
        type: "bot.transaction.committed",
        txHash: `0x${"44".repeat(32)}`,
        elapsedMs: 12,
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
      runId: "run-0",
      txHash: `0x${"44".repeat(32)}`,
      elapsedMs: 12,
    });
    expect(line).toMatch(/"timestamp":"\d{4}-\d\d-\d\dT[^"]*Z"/u);
  });

  it("creates process ids with timestamp and process evidence", () => {
    expect(createProcessId()).toMatch(/^\d{4}-\d\d-\d\dT.*Z-[\da-z]+$/u);
  });

  it("opens a new run id at each turn start, keeping the process prefix", () => {
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      const emitter = new BotEventEmitter({ chain: "testnet", processId: "run" });
      emitter.emit({ type: "bot.turn.started" });
      emitter.emit({ type: "bot.turn.failed", error: "first" });
      emitter.emit({ type: "bot.turn.started" });
    } finally {
      stdoutWrite.mockRestore();
    }

    expect(output.map((line) => /"runId":"([^"]*)"/u.exec(line)?.[1])).toEqual([
      "run-1",
      "run-1",
      "run-2",
    ]);
  });
});
