import { afterEach, describe, expect, it, vi } from "vitest";
import { autoScenarioDraw } from "../../../../src/tester/planning/testerPlanning.ts";
import type { ExecutionLog } from "../../../../src/tester/runtime/testerTypes.ts";
import {
  CKB_TO_ICKB_DIRECTION,
  ESTIMATED_TOO_SMALL_REASON,
  ICKB_TO_CKB_DIRECTION,
  buildBaseTransactionMock,
  ccc,
  completeTransactionMock,
  planTesterAttempt,
  requestMock,
  runtimeWithSdk,
  testerState,
} from "./support.ts";

const MULTI_ORDER = "multi-order-limit-orders";
const DUST_CKB = "dust-ckb-conversion";

/** Points Math.random at one entry of the weighted draw. */
function drawing(scenario: string, draw: readonly string[]): () => number {
  const index = draw.indexOf(scenario);
  return () => (index + 0.5) / draw.length;
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("planTesterAttempt under auto", () => {
  const feePolicy = { fee: 1n, feeBase: 100000n };
  const depositCapacity = ccc.fixedPointFrom(1000);
  const funded = testerState({
    availableCkbBalance: ccc.fixedPointFrom(650000),
    plainCkbBalance: ccc.fixedPointFrom(1000),
    availableIckbBalance: ccc.fixedPointFrom(123),
  });

  it("reaches a mixed-direction plan through the composite resolver", async () => {
    const draw = autoScenarioDraw(funded, depositCapacity, feePolicy);
    vi.spyOn(Math, "random").mockImplementation(drawing(MULTI_ORDER, draw));
    const calls: string[] = [];
    const executionLog: ExecutionLog = {};

    const planned = await planTesterAttempt({
      runtime: runtimeWithSdk({
        buildBaseTransaction: buildBaseTransactionMock(calls),
        request: requestMock(calls),
        completeTransaction: completeTransactionMock(calls),
      }),
      state: funded,
      testerScenario: "auto",
      feePolicy,
      depositCapacity,
      totalEquivalentCkb: ccc.fixedPointFrom(650123),
      executionLog,
    });

    expect(planned).toMatchObject({
      effectiveTesterScenario: "mixed-direction-limit-orders",
    });
    expect(planned?.rawOrders.map((order) => order.direction)).toEqual([
      CKB_TO_ICKB_DIRECTION,
      ICKB_TO_CKB_DIRECTION,
    ]);
    expect(executionLog.skip).toBeUndefined();
  });

  it("records the intentional rejection when it draws a dust scenario", async () => {
    const draw = autoScenarioDraw(funded, depositCapacity, feePolicy);
    vi.spyOn(Math, "random").mockImplementation(drawing(DUST_CKB, draw));
    const executionLog: ExecutionLog = {};

    const planned = await planTesterAttempt({
      runtime: runtimeWithSdk({}),
      state: funded,
      testerScenario: "auto",
      feePolicy,
      depositCapacity,
      totalEquivalentCkb: ccc.fixedPointFrom(650123),
      executionLog,
    });

    expect(planned).toBeUndefined();
    expect(executionLog.skip).toMatchObject({
      reason: ESTIMATED_TOO_SMALL_REASON,
      requestedTesterScenario: "auto",
      testerScenario: DUST_CKB,
      attemptedOrder: { giveCkb: "0.00000001" },
    });
  });

  it("holds with exit 2 below the capital minimum even though a dust order is affordable", async () => {
    const depleted = testerState({ availableCkbBalance: 0n, availableIckbBalance: 1n });
    expect(autoScenarioDraw(depleted, depositCapacity, feePolicy)).toEqual([
      "dust-ickb-conversion",
    ]);
    const executionLog: ExecutionLog = {};

    const planned = await planTesterAttempt({
      runtime: runtimeWithSdk({}),
      state: depleted,
      testerScenario: "auto",
      feePolicy,
      depositCapacity,
      totalEquivalentCkb: 1n,
      executionLog,
    });

    expect(planned).toBeUndefined();
    expect(executionLog.skip).toBeUndefined();
    expect(executionLog.error).toBe(
      "Not enough funds to continue testing, shutting down...",
    );
    expect(process.exitCode).toBe(2);
  });
});
