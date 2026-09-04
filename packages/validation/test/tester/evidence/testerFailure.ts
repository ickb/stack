import { ccc } from "@ckb-ccc/core";
import { OrderConversionRepresentabilityError } from "@ickb/order";
import { IckbSdk } from "@ickb/sdk";
import { byte32FromByte, script } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import {
  handleTesterAttemptError,
  hasActionableTesterScenarioEstimate,
  isRetryableTesterError,
  isUnrepresentableTesterEstimateError,
  stopForLowTesterCapital,
  transactionShape,
} from "../../../src/tester/index.ts";
import { MissingFreshOrderOriginError } from "../../../src/tester/runtime/freshMatchableOrderSkip.ts";
import {
  DUPLICATED_TX_ERROR_MESSAGE,
  FETCH_FAILED_MESSAGE,
  RANDOM_ORDER_SCENARIO,
  testerState,
} from "../../support/tester/index.ts";

describe("isRetryableTesterError", () => {
  it("recognizes live retryable CKB state races", () => {
    expect(
      isRetryableTesterError(
        Object.assign(new Error(DUPLICATED_TX_ERROR_MESSAGE), {
          code: -1107,
          data: `Duplicated(Byte32(0x${"22".repeat(32)}))`,
          txHash: `0x${"22".repeat(32)}`,
        }),
      ),
    ).toBe(true);
    expect(isRetryableTesterError(new Error("Not enough CKB"))).toBe(false);
  });

  it("recognizes live retryable RPC transport and response-shape failures", () => {
    expect(isRetryableTesterError(new TypeError(FETCH_FAILED_MESSAGE))).toBe(true);
    expect(
      isRetryableTesterError(
        new Error(FETCH_FAILED_MESSAGE, {
          cause: new TypeError(FETCH_FAILED_MESSAGE),
        }),
      ),
    ).toBe(true);
    expect(
      isRetryableTesterError(new Error("Id mismatched, got null, expected 319")),
    ).toBe(true);
    expect(
      isRetryableTesterError(
        new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"),
      ),
    ).toBe(true);
    expect(isRetryableTesterError(new Error(FETCH_FAILED_MESSAGE))).toBe(false);
  });
});
describe("handleTesterAttemptError", () => {
  it("records retryable failures and exits 1 so the next turn can retry", () => {
    const originalExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const executionLog: Record<string, unknown> = { startTime: "fixture" };

      handleTesterAttemptError(
        Object.assign(new Error(DUPLICATED_TX_ERROR_MESSAGE), {
          code: -1107,
          data: `Duplicated(Byte32(0x${"22".repeat(32)}))`,
          txHash: byte32FromByte("22"),
        }),
        executionLog,
      );

      expect(process.exitCode).toBe(1);
      expect(executionLog["error"]).toEqual({
        message: "Retryable tester error",
        retryable: true,
        error: {
          name: "Error",
          message: DUPLICATED_TX_ERROR_MESSAGE,
          code: -1107,
          data: `Duplicated(Byte32(0x${"22".repeat(32)}))`,
          txHash: byte32FromByte("22"),
        },
      });

      const plainLog: Record<string, unknown> = {};
      handleTesterAttemptError(
        { code: -301, data: `Resolve(Dead(OutPoint(0x${"11".repeat(32)}00000000)))` },
        plainLog,
      );
      expect(plainLog["error"]).toMatchObject({
        retryable: true,
        error: { message: "Retryable tester error" },
      });
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("records deterministic failures with exit 1", () => {
    const originalExitCode = process.exitCode;
    try {
      process.exitCode = 2;
      const executionLog: Record<string, unknown> = { startTime: "fixture" };

      handleTesterAttemptError(
        new Error("SDK conversion failed: deterministic fixture"),
        executionLog,
      );

      expect(process.exitCode).toBe(1);
      expect(executionLog["error"]).toMatchObject({
        message: "SDK conversion failed: deterministic fixture",
      });
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("holds after a confirmation timeout and for missing fresh-order provenance", () => {
    const originalExitCode = process.exitCode;
    try {
      class TransactionConfirmationError extends Error {
        public readonly isTimeout = true;

        public override readonly name = "TransactionConfirmationError";
      }
      process.exitCode = undefined;
      handleTesterAttemptError(
        new TransactionConfirmationError("confirmation timed out"),
        {},
      );
      expect(process.exitCode).toBe(2);

      process.exitCode = undefined;
      const missingOrigin = new MissingFreshOrderOriginError(byte32FromByte("12"));
      expect(isRetryableTesterError(missingOrigin)).toBe(false);
      handleTesterAttemptError(missingOrigin, {});
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});
describe("isUnrepresentableTesterEstimateError", () => {
  it("recognizes fee-adjusted ratio overflow as an unbuildable tester estimate", () => {
    const error = new OrderConversionRepresentabilityError();

    expect(isUnrepresentableTesterEstimateError(error)).toBe(true);
    expect(
      isUnrepresentableTesterEstimateError(new Error("Ratio scale exceeds Uint64")),
    ).toBe(false);
  });
});
describe("transactionShape", () => {
  it("reports only transaction structure counts", () => {
    const tx = ccc.Transaction.default();
    tx.inputs.push(
      ccc.CellInput.from({
        previousOutput: { txHash: byte32FromByte("01"), index: 0n },
      }),
    );
    tx.addOutput({ capacity: 100n, lock: script("11") }, "0x1234");
    tx.cellDeps.push(
      ccc.CellDep.from({
        outPoint: { txHash: byte32FromByte("02"), index: 0n },
        depType: "code",
      }),
    );
    tx.headerDeps.push(byte32FromByte("03"));
    tx.witnesses.push(ccc.WitnessArgs.from({ inputType: "0xab" }).toHex());

    expect(transactionShape(tx)).toEqual({
      inputs: 1,
      outputs: 1,
      outputsData: 1,
      cellDeps: 1,
      headerDeps: 1,
      witnesses: 1,
    });
  });
});
describe("random planning edge cases", () => {
  it("throws non-terminal estimator failures instead of treating them as unfunded", () => {
    const estimate = vi.spyOn(IckbSdk, "estimate").mockImplementation(() => {
      throw new Error("unexpected random estimate failure");
    });
    try {
      expect(() =>
        hasActionableTesterScenarioEstimate(
          testerState({ availableCkbBalance: ccc.fixedPointFrom(4000) }),
          ccc.fixedPointFrom(1000),
          RANDOM_ORDER_SCENARIO,
        ),
      ).toThrow("unexpected random estimate failure");
    } finally {
      estimate.mockRestore();
    }
  });
});
describe("stopForLowTesterCapital", () => {
  it("records the low-capital stop as an intentional safety stop", () => {
    const originalExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const executionLog: Record<string, unknown> = { startTime: "fixture" };

      stopForLowTesterCapital(executionLog);

      expect(process.exitCode).toBe(2);
      expect(executionLog["error"]).toBe(
        "Not enough funds to continue testing, shutting down...",
      );
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});
