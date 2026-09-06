import { Ratio } from "@ickb/sdk";
import { describe, expect, it, vi } from "vitest";

import {
  ESTIMATED_TOO_SMALL_REASON,
  capacityCell,
  captureStdout,
  ccc,
  runTesterTurn,
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

describe("runTesterTurn", () => {
  it("runs one attempt and writes one execution log line", async () => {
    const { output, stdoutWrite } = captureStdout();
    try {
      await runTesterTurn({
        runtime: noActionableAutoTesterRuntime("49"),
        testerScenario: "auto",
        feePolicy: { fee: 1n, feeBase: 100000n },
      });

      expect(output.join("\n").split(ESTIMATED_TOO_SMALL_REASON)).toHaveLength(2);
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it.each([
    [
      new TypeError("fetch failed"),
      '"error":{"name":"TypeError","message":"fetch failed"',
    ],
    [new Error("deterministic state failure"), "deterministic state failure"],
  ])("records %s and exits 1", async (failure, expectedText) => {
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
          throw failure;
        },
      });

      await runTesterTurn({
        runtime,
        testerScenario: "auto",
        feePolicy: { fee: 1n, feeBase: 100000n },
      });

      expect(process.exitCode).toBe(1);
      expect(output.join("\n")).toContain(expectedText);
    } finally {
      stdoutWrite.mockRestore();
      process.exitCode = originalExitCode;
    }
  });
});
