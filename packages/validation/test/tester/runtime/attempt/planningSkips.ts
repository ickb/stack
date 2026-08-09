import { describe, expect, it, vi } from "vitest";

import {
  ESTIMATED_TOO_SMALL_REASON,
  LOW_CAPITAL_MESSAGE,
  ccc,
  planTesterAttempt,
  runtimeWithSdk,
  startTime,
  testerState,
} from "./support.ts";

describe("planTesterAttempt", () => {
  it("skips auto attempts when no scenario is funded", async () => {
    const executionLog: Record<string, unknown> = {};
    const result = await planTesterAttempt({
      runtime: runtimeWithSdk({}),
      state: testerState({ availableCkbBalance: ccc.fixedPointFrom(1000) + 1n }),
      testerScenario: "auto",
      feePolicy: { fee: 1n, feeBase: 100000n },
      depositCapacity: ccc.fixedPointFrom(1000),
      totalEquivalentCkb: ccc.fixedPointFrom(1000) + 1n,
      executionLog,
      startTime,
    });

    expect(result).toBeUndefined();
    expect(executionLog["skip"]).toMatchObject({
      reason: ESTIMATED_TOO_SMALL_REASON,
      requestedTesterScenario: "auto",
    });
  });

  it("stops when unfunded auto mode has fallen below minimum tester capital", async () => {
    const originalExitCode = process.exitCode;
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      process.exitCode = undefined;
      const executionLog: Record<string, unknown> = {};

      const result = await planTesterAttempt({
        runtime: runtimeWithSdk({}),
        state: testerState({ availableCkbBalance: 0n }),
        testerScenario: "auto",
        feePolicy: { fee: 1n, feeBase: 100000n },
        depositCapacity: ccc.fixedPointFrom(1000),
        totalEquivalentCkb: 1n,
        executionLog,
        startTime,
      });

      expect(result).toBe("stop");
      expect(process.exitCode).toBe(2);
      expect(executionLog["error"]).toBe(LOW_CAPITAL_MESSAGE);
    } finally {
      stdoutWrite.mockRestore();
      process.exitCode = originalExitCode;
    }
  });

  it("skips sampled random plans that produce no raw orders", async () => {
    const executionLog: Record<string, unknown> = {};

    const result = await planTesterAttempt({
      runtime: runtimeWithSdk({}),
      state: testerState({ availableCkbBalance: ccc.fixedPointFrom(2000) }),
      testerScenario: "random-order",
      feePolicy: { fee: 1n, feeBase: 100000n },
      depositCapacity: ccc.fixedPointFrom(1000),
      totalEquivalentCkb: ccc.fixedPointFrom(2000),
      executionLog,
      startTime,
    });

    expect(result).toBeUndefined();
    expect(executionLog["skip"]).toEqual({ reason: "sampled-amount-too-small" });
  });
});
