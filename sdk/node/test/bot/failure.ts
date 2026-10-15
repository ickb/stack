import { expect, it, vi } from "vitest";
import { BotEventEmitter } from "../../src/bot/events.ts";

const POOL_REJECTED_RBF = "Client request error PoolRejectedRBF";

function emitted(emit: () => void): object {
  const output: string[] = [];
  const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  try {
    emit();
  } finally {
    stdoutWrite.mockRestore();
  }
  expect(output).toHaveLength(1);
  const parsed: unknown = JSON.parse(output[0] ?? "");
  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("Expected one JSON object");
  }
  return parsed;
}

it("journals a failure with its public fields, cause, and stack", () => {
  const emitter = new BotEventEmitter({ chain: "testnet", runId: "run-1" });
  const error = Object.assign(
    new Error(POOL_REJECTED_RBF, { cause: new TypeError("fetch failed") }),
    { code: -1111, data: "RBFRejected(...)", txHash: `0x${"11".repeat(32)}` },
  );

  const event = emitted(() => {
    emitter.emit({ type: "bot.turn.failed", error });
  });

  expect(event).toMatchObject({
    type: "bot.turn.failed",
    chain: "testnet",
    runId: "run-1",
    error: {
      name: "Error",
      message: POOL_REJECTED_RBF,
      code: -1111,
      data: "RBFRejected(...)",
      txHash: `0x${"11".repeat(32)}`,
      cause: { name: "TypeError", message: "fetch failed" },
    },
  });
  expect(JSON.stringify(event)).toContain(`"stack":"Error: ${POOL_REJECTED_RBF}`);
});

it("journals thrown non-errors as they are", () => {
  const emitter = new BotEventEmitter({ chain: "testnet", runId: "run-1" });

  expect(
    emitted(() => {
      emitter.emit({ type: "bot.turn.failed", error: "raw thrown string" });
    }),
  ).toMatchObject({ type: "bot.turn.failed", error: "raw thrown string" });
});
