import { describe, expect, it, vi } from "vitest";

import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  ESTIMATED_TOO_SMALL_REASON,
  LOW_CAPITAL_MESSAGE,
  byte32FromByte,
  ccc,
  headerLike,
  matchableOrder,
  runTesterAttempt,
  runtimeWithSdk,
  systemState,
  withdrawal,
  type TransactionResponse,
} from "./support.ts";

describe("runTesterAttempt skip outcomes", () => {
  it("returns stop when planning stops for low tester capital", async () => {
    const originalExitCode = process.exitCode;
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      process.exitCode = undefined;
      const runtime = runtimeWithSdk({
        getL1AccountState: async () => {
          await Promise.resolve();
          return {
            system: systemState(),
            user: { orders: [] },
            account: {
              capacityCells: [],
              nativeUdtCells: [],
              nativeUdtCapacity: 0n,
              nativeUdtBalance: 0n,
              receipts: [],
              withdrawalGroups: [],
            },
          };
        },
      });
      const executionLog: Record<string, unknown> = {};

      await runTesterAttempt({
        runtime,
        testerScenario: "auto",
        feePolicy: { fee: 1n, feeBase: 100000n },
        executionLog,
      });
      expect(process.exitCode).toBe(2);
      expect(executionLog["error"]).toBe(LOW_CAPITAL_MESSAGE);
    } finally {
      stdoutWrite.mockRestore();
      process.exitCode = originalExitCode;
    }
  });
});

describe("runTesterAttempt pending-capital outcomes", () => {
  it("keeps pending withdrawal capital in totals but unavailable to planning", async () => {
    const originalExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const pendingCkb = ccc.fixedPointFrom(6000);
      const runtime = runtimeWithSdk({
        getL1AccountState: async () => {
          await Promise.resolve();
          return {
            system: systemState(),
            user: { orders: [] },
            account: {
              capacityCells: [],
              nativeUdtCells: [],
              nativeUdtCapacity: 0n,
              nativeUdtBalance: 0n,
              receipts: [],
              withdrawalGroups: [withdrawal(pendingCkb, false)],
            },
          };
        },
      });
      const executionLog: Record<string, unknown> = {};

      await runTesterAttempt({
        runtime,
        testerScenario: "auto",
        feePolicy: { fee: 1n, feeBase: 100000n },
        executionLog,
      });
      expect(process.exitCode).toBeUndefined();
      expect(executionLog["skip"]).toMatchObject({
        reason: ESTIMATED_TOO_SMALL_REASON,
        requestedTesterScenario: "auto",
      });
      expect(executionLog["balance"]).toMatchObject({
        CKB: { total: "6000", available: "0", unavailable: "6000" },
        ICKB: { total: "0", available: "0", unavailable: "0" },
        totalEquivalent: { CKB: "6000", ICKB: "6000" },
      });
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});

describe("runTesterAttempt fresh-order outcomes", () => {
  it("records fresh-order skips before planning", async () => {
    const tip = headerLike({ number: 200n });
    const runtime = runtimeWithSdk({
      getL1AccountState: async () => {
        await Promise.resolve();
        return {
          system: systemState({ tip }),
          user: { orders: [] },
          account: {
            capacityCells: [],
            nativeUdtCells: [],
            nativeUdtCapacity: 0n,
            nativeUdtBalance: 0n,
            receipts: [],
            withdrawalGroups: [],
          },
        };
      },
    });
    const txHash = byte32FromByte("44");
    const order = await matchableOrder(txHash);
    runtime.sdk.getL1AccountState = async (): ReturnType<
      typeof runtime.sdk.getL1AccountState
    > => {
      await Promise.resolve();
      return {
        system: systemState({ tip }),
        user: { orders: [order] },
        account: {
          capacityCells: [],
          nativeUdtCells: [],
          nativeUdtCapacity: 0n,
          nativeUdtBalance: 0n,
          receipts: [],
          withdrawalGroups: [],
        },
      };
    };
    runtime.client.cache.getTransactionResponse =
      async (): Promise<TransactionResponse> => {
        await Promise.resolve();
        return ccc.ClientTransactionResponse.from({
          transaction: ccc.Transaction.default(),
          status: "committed",
          blockNumber: 100n,
        });
      };
    const executionLog: Record<string, unknown> = {};

    await runTesterAttempt({
      runtime,
      testerScenario: ALL_CKB_LIMIT_ORDER_SCENARIO,
      feePolicy: { fee: 1n, feeBase: 100000n },
      executionLog,
    });
    expect(executionLog["skip"]).toMatchObject({
      reason: "fresh-matchable-order",
      txHash,
      blockNumber: 100n,
      tipNumber: 200n,
    });
  });
});
