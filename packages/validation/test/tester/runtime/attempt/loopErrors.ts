import { Ratio } from "@ickb/order";
import { describe, expect, it, vi } from "vitest";

import {
  ESTIMATED_TOO_SMALL_REASON,
  capacityCell,
  captureStdout,
  ccc,
  runTesterLoop,
  runtimeWithSdk,
  script,
  systemState,
} from "./support.ts";

const noActionableAutoTesterRuntime = (
  cellByte: string,
): ReturnType<typeof runtimeWithSdk> =>
  runtimeWithSdk({
    getL1AccountState: async () => {
      await Promise.resolve();
      return {
        system: systemState({
          exchangeRatio: Ratio.from({ ckbScale: 100n, udtScale: 1n }),
        }),
        user: { orders: [] },
        account: {
          capacityCells: [capacityCell(ccc.fixedPointFrom(1999), script("11"), cellByte)],
          nativeUdtCells: [],
          nativeUdtCapacity: 0n,
          nativeUdtBalance: 0n,
          receipts: [],
          withdrawalGroups: [],
        },
      };
    },
  });

describe("runTesterLoop terminal iterations", () => {
  it("stops after max iterations without sleeping before the first attempt", async () => {
    const { output, stdoutWrite } = captureStdout();
    try {
      const runtime = noActionableAutoTesterRuntime("49");

      await runTesterLoop({
        runtime,
        testerScenario: "auto",
        feePolicy: { fee: 1n, feeBase: 100000n },
        sleepIntervalMs: 1,
        maxIterations: 1,
        maxRetryableAttempts: 1,
      });

      expect(output.join("\n")).toContain(ESTIMATED_TOO_SMALL_REASON);
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("continues after a nonterminal iteration before reaching max iterations", async () => {
    const { output, stdoutWrite } = captureStdout();
    try {
      const runtime = noActionableAutoTesterRuntime("4a");

      await runTesterLoop({
        runtime,
        testerScenario: "auto",
        feePolicy: { fee: 1n, feeBase: 100000n },
        sleepIntervalMs: 0,
        maxIterations: 2,
        maxRetryableAttempts: 1,
      });

      expect(output.join("\n").split(ESTIMATED_TOO_SMALL_REASON)).toHaveLength(3);
    } finally {
      stdoutWrite.mockRestore();
    }
  });
});

describe("runTesterLoop error handling", () => {
  it("retries retryable attempt failures until the budget is exhausted", async () => {
    const originalExitCode = process.exitCode;
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      process.exitCode = undefined;
      const runtime = runtimeWithSdk({
        getL1AccountState: async () => {
          await Promise.resolve();
          throw new TypeError("fetch failed");
        },
      });

      await runTesterLoop({
        runtime,
        testerScenario: "auto",
        feePolicy: { fee: 1n, feeBase: 100000n },
        sleepIntervalMs: 0,
        maxIterations: undefined,
        maxRetryableAttempts: 2,
      });

      expect(process.exitCode).toBe(2);
      expect(output.join("\n")).toContain("Retryable tester error budget exhausted");
    } finally {
      stdoutWrite.mockRestore();
      process.exitCode = originalExitCode;
    }
  });

  it("stops after non-retryable attempt failures", async () => {
    const originalExitCode = process.exitCode;
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      process.exitCode = undefined;
      const runtime = runtimeWithSdk({
        getL1AccountState: async () => {
          await Promise.resolve();
          throw new Error("deterministic state failure");
        },
      });

      await runTesterLoop({
        runtime,
        testerScenario: "auto",
        feePolicy: { fee: 1n, feeBase: 100000n },
        sleepIntervalMs: 0,
        maxIterations: undefined,
        maxRetryableAttempts: 2,
      });

      expect(process.exitCode).toBe(1);
      expect(output.join("\n")).toContain("deterministic state failure");
    } finally {
      stdoutWrite.mockRestore();
      process.exitCode = originalExitCode;
    }
  });
});
