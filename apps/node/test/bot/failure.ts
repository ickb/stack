import { afterEach, expect, it } from "vitest";
import { BotEventEmitter } from "../../src/bot/events.ts";
import { handleTurnFailure } from "../../src/bot/failure.ts";
import type { JsonLogRecord } from "../../src/shared/index.ts";

const POOL_REJECTED_RBF = "Client request error PoolRejectedRBF";

afterEach(() => {
  process.exitCode = undefined;
});

it("exits 1 and emits the error with its public fields, cause, and stack", () => {
  const events: JsonLogRecord[] = [];
  const emitter = new BotEventEmitter({
    chain: "testnet",
    runId: "run-1",
    write: (event): void => {
      events.push(event);
    },
  });
  const error = Object.assign(
    new Error(POOL_REJECTED_RBF, { cause: new TypeError("fetch failed") }),
    { code: -1111, data: "RBFRejected(...)", txHash: `0x${"11".repeat(32)}` },
  );

  handleTurnFailure(emitter, error);

  expect(process.exitCode).toBe(1);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
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
  expect(JSON.stringify(events[0])).toContain(`"stack":"Error: ${POOL_REJECTED_RBF}`);
});

it("emits thrown non-errors as they are", () => {
  const events: JsonLogRecord[] = [];
  const emitter = new BotEventEmitter({
    chain: "testnet",
    runId: "run-1",
    write: (event): void => {
      events.push(event);
    },
  });

  handleTurnFailure(emitter, "raw thrown string");

  expect(process.exitCode).toBe(1);
  expect(events[0]).toMatchObject({
    type: "bot.turn.failed",
    error: "raw thrown string",
  });
});
