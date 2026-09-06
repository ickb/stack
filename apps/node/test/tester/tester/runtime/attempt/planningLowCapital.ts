import { describe, expect, it, vi } from "vitest";

import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  DUST_ICKB_CONVERSION_SCENARIO,
  ESTIMATED_TOO_SMALL_REASON,
  IckbSdk,
  LOW_CAPITAL_MESSAGE,
  OrderConversionRepresentabilityError,
  ccc,
  planTesterAttempt,
  runtimeWithSdk,
  testerState,
} from "./support.ts";

describe("planTesterAttempt low-capital outcomes", () => {
  it("stops when sampled random plans are empty below minimum tester capital", async () => {
    const originalExitCode = process.exitCode;
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      process.exitCode = undefined;
      const executionLog: Record<string, unknown> = {};

      const result = await planTesterAttempt({
        runtime: runtimeWithSdk({}),
        state: testerState({ availableCkbBalance: 0n }),
        testerScenario: "random-order",
        feePolicy: { fee: 1n, feeBase: 100000n },
        depositCapacity: ccc.fixedPointFrom(1000),
        totalEquivalentCkb: 1n,
        executionLog,
      });
      expect(result).toBeUndefined();
      expect(process.exitCode).toBe(2);
      expect(executionLog["error"]).toBe(LOW_CAPITAL_MESSAGE);
    } finally {
      stdoutWrite.mockRestore();
      process.exitCode = originalExitCode;
    }
  });

  it("records unbuildable raw-order estimates before building a transaction", async () => {
    const estimate = vi.spyOn(IckbSdk, "estimate").mockImplementation(() => {
      throw new OrderConversionRepresentabilityError();
    });
    try {
      const executionLog: Record<string, unknown> = {};

      const result = await planTesterAttempt({
        runtime: runtimeWithSdk({}),
        state: testerState({ availableCkbBalance: ccc.fixedPointFrom(4000) }),
        testerScenario: ALL_CKB_LIMIT_ORDER_SCENARIO,
        feePolicy: { fee: 1n, feeBase: 100000n },
        depositCapacity: ccc.fixedPointFrom(1000),
        totalEquivalentCkb: ccc.fixedPointFrom(4000),
        executionLog,
      });

      expect(result).toBeUndefined();
      expect(executionLog["skip"]).toMatchObject({
        reason: ESTIMATED_TOO_SMALL_REASON,
        testerScenario: ALL_CKB_LIMIT_ORDER_SCENARIO,
        attemptedOrder: { giveCkb: "2000" },
      });
    } finally {
      estimate.mockRestore();
    }
  });

  it("skips raw orders whose SDK estimate is unbuildable", async () => {
    const executionLog: Record<string, unknown> = {};

    const result = await planTesterAttempt({
      runtime: runtimeWithSdk({}),
      state: testerState({ availableCkbBalance: 0n, availableIckbBalance: 1n }),
      testerScenario: DUST_ICKB_CONVERSION_SCENARIO,
      feePolicy: { fee: 1n, feeBase: 100000n },
      depositCapacity: ccc.fixedPointFrom(1000),
      totalEquivalentCkb: ccc.fixedPointFrom(2000),
      executionLog,
    });

    expect(result).toBeUndefined();
    expect(executionLog["skip"]).toMatchObject({
      reason: ESTIMATED_TOO_SMALL_REASON,
      testerScenario: DUST_ICKB_CONVERSION_SCENARIO,
    });
  });
});
