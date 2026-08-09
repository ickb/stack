import { ccc } from "@ckb-ccc/core";
import { OrderConversionRepresentabilityError } from "@ickb/order";
import { IckbSdk } from "@ickb/sdk";
import { byte32FromByte, script } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import {
  handleTesterAttemptError,
  hasActionableTesterScenarioEstimate,
  isRetryableTesterError,
  isTerminalTesterError,
  isUnrepresentableTesterEstimateError,
  shouldSleepBeforeTesterAttempt,
  stopForLowTesterCapital,
  testerRetryableFailureFields,
  transactionShape,
} from "../../../src/tester/index.ts";
import { MissingFreshOrderOriginError } from "../../../src/tester/runtime/freshMatchableOrderSkip.ts";
import {
  DUPLICATED_TX_ERROR_MESSAGE,
  FETCH_FAILED_MESSAGE,
  RANDOM_ORDER_SCENARIO,
  testerState,
} from "../../support/tester/index.ts";

const RETRYABLE_ATTEMPTS = 2;
const RETRYABLE_TESTER_ERROR = "Retryable tester error";

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
describe("isTerminalTesterError", () => {
  it("stops the tester loop for missing fresh-order provenance", () => {
    const error = new MissingFreshOrderOriginError(byte32FromByte("11"));

    expect(isRetryableTesterError(error)).toBe(false);
    expect(isTerminalTesterError(error)).toBe(true);
  });
});
describe("testerRetryableFailureFields", () => {
  it("marks retryable failures terminal only when the retry budget is exhausted", () => {
    const transportError = new TypeError(FETCH_FAILED_MESSAGE);
    expect(testerRetryableFailureFields(transportError, 1, 2)).toMatchObject({
      message: RETRYABLE_TESTER_ERROR,
      retryable: true,
      terminal: false,
      retryableAttempts: 1,
      maxRetryableAttempts: 2,
      retryBudgetExhausted: false,
      error: {
        name: "TypeError",
        message: transportError.message,
      },
    });

    expect(
      testerRetryableFailureFields(
        Object.assign(new Error(DUPLICATED_TX_ERROR_MESSAGE), {
          code: -1107,
          data: `Duplicated(Byte32(0x${"22".repeat(32)}))`,
          txHash: byte32FromByte("22"),
        }),
        RETRYABLE_ATTEMPTS,
        RETRYABLE_ATTEMPTS,
      ),
    ).toMatchObject({
      message: `${RETRYABLE_TESTER_ERROR} budget exhausted`,
      retryable: true,
      terminal: true,
      retryableAttempts: RETRYABLE_ATTEMPTS,
      maxRetryableAttempts: RETRYABLE_ATTEMPTS,
      retryBudgetExhausted: true,
      error: {
        name: "Error",
        message: DUPLICATED_TX_ERROR_MESSAGE,
        code: -1107,
        data: `Duplicated(Byte32(0x${"22".repeat(32)}))`,
        txHash: byte32FromByte("22"),
      },
    });
  });

  it("formats non-Error retryable evidence without a max budget", () => {
    expect(testerRetryableFailureFields("transport", 1, undefined)).toEqual({
      message: RETRYABLE_TESTER_ERROR,
      error: { message: RETRYABLE_TESTER_ERROR },
      retryable: true,
      terminal: false,
      retryableAttempts: 1,
      retryBudgetExhausted: false,
    });
  });
});
describe("handleTesterAttemptError", () => {
  it("stops on deterministic non-retryable errors", () => {
    const originalExitCode = process.exitCode;
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      process.exitCode = undefined;
      const executionLog: Record<string, unknown> = { startTime: "fixture" };

      const result = handleTesterAttemptError(
        new Error("SDK conversion failed: deterministic fixture"),
        executionLog,
        new Date(),
        0,
        RETRYABLE_ATTEMPTS,
      );

      expect(result).toEqual({ result: "stop", retryableAttempts: 0 });
      expect(process.exitCode).toBe(1);
      expect(output.join("\n")).toContain("SDK conversion failed: deterministic fixture");
    } finally {
      stdoutWrite.mockRestore();
      process.exitCode = originalExitCode;
    }
  });

  it("sets a failing exit code for generic loop errors", () => {
    const originalExitCode = process.exitCode;
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      process.exitCode = 2;
      const executionLog: Record<string, unknown> = { startTime: "fixture" };

      const result = handleTesterAttemptError(
        new Error("already stopped"),
        executionLog,
        new Date(),
        0,
        RETRYABLE_ATTEMPTS,
      );

      expect(result).toEqual({ result: "stop", retryableAttempts: 0 });
      expect(process.exitCode).toBe(1);
      expect(output.join("\n")).toContain("already stopped");
    } finally {
      stdoutWrite.mockRestore();
      process.exitCode = originalExitCode;
    }
  });
});

describe("handleTesterAttemptError stop errors", () => {
  it("preserves stop exit code from confirmation timeout errors", () => {
    const originalExitCode = process.exitCode;
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      process.exitCode = undefined;
      const executionLog: Record<string, unknown> = { startTime: "fixture" };
      class TransactionConfirmationError extends Error {
        public readonly isTimeout = true;

        public override readonly name = "TransactionConfirmationError";
      }
      const timeoutError = new TransactionConfirmationError("confirmation timed out");

      const result = handleTesterAttemptError(
        timeoutError,
        executionLog,
        new Date(),
        0,
        RETRYABLE_ATTEMPTS,
      );

      expect(result).toEqual({ result: "stop", retryableAttempts: 0 });
      expect(process.exitCode).toBe(2);
      expect(output.join("\n")).toContain("confirmation timed out");
    } finally {
      stdoutWrite.mockRestore();
      process.exitCode = originalExitCode;
    }
  });
});

describe("handleTesterAttemptError terminal errors", () => {
  it("stops terminal tester errors without retrying", () => {
    const originalExitCode = process.exitCode;
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      process.exitCode = undefined;
      const executionLog: Record<string, unknown> = { startTime: "fixture" };

      const result = handleTesterAttemptError(
        new MissingFreshOrderOriginError(byte32FromByte("12")),
        executionLog,
        new Date(),
        3,
        4,
      );

      expect(result).toEqual({ result: "stop", retryableAttempts: 3 });
      expect(process.exitCode).toBe(1);
      expect(output.join("\n")).toContain("Missing origin transaction block number");
    } finally {
      stdoutWrite.mockRestore();
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
describe("shouldSleepBeforeTesterAttempt", () => {
  it("runs the first attempt immediately and sleeps before later attempts", () => {
    expect(shouldSleepBeforeTesterAttempt(0)).toBe(false);
    expect(shouldSleepBeforeTesterAttempt(1)).toBe(true);
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
  it("logs the low-capital stop as an intentional safety stop", () => {
    const originalExitCode = process.exitCode;
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      process.exitCode = undefined;
      const executionLog: Record<string, unknown> = { startTime: "fixture" };

      stopForLowTesterCapital(executionLog, new Date());

      expect(process.exitCode).toBe(2);
      expect(executionLog["error"]).toBe(
        "Not enough funds to continue testing, shutting down...",
      );
      expect(output.join("\n")).toContain("Not enough funds to continue testing");
    } finally {
      stdoutWrite.mockRestore();
      process.exitCode = originalExitCode;
    }
  });
});
