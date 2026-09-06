import { ccc } from "@ckb-ccc/core";
import { IckbSdk, OrderConversionRepresentabilityError } from "@ickb/sdk";

import { byte32FromByte, script } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import { transactionShape } from "../../../../src/tester/tester/evidence/testerEvidence.ts";
import { isUnrepresentableTesterEstimateError } from "../../../../src/tester/tester/planning/testerOrderPlanning.ts";
import { hasActionableTesterScenarioEstimate } from "../../../../src/tester/tester/planning/testerPlanning.ts";
import { handleTesterAttemptError } from "../../../../src/tester/tester/runtime/testerErrors.ts";
import { stopForLowTesterCapital } from "../../../../src/tester/tester/runtime/testerStop.ts";
import type { ExecutionLog } from "../../../../src/tester/tester/runtime/testerTypes.ts";
import {
  DUPLICATED_TX_ERROR_MESSAGE,
  RANDOM_ORDER_SCENARIO,
  testerState,
} from "../../support/tester/index.ts";

describe("handleTesterAttemptError", () => {
  it("records the error with its public RPC fields and stack, then exits 1", () => {
    const originalExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const executionLog: ExecutionLog = { startTime: "fixture" };

      handleTesterAttemptError(
        Object.assign(new Error(DUPLICATED_TX_ERROR_MESSAGE), {
          code: -1107,
          data: `Duplicated(Byte32(0x${"22".repeat(32)}))`,
          txHash: byte32FromByte("22"),
        }),
        executionLog,
      );

      expect(process.exitCode).toBe(1);
      expect(executionLog.error).toMatchObject({
        name: "Error",
        message: DUPLICATED_TX_ERROR_MESSAGE,
        code: -1107,
        data: `Duplicated(Byte32(0x${"22".repeat(32)}))`,
        txHash: byte32FromByte("22"),
      });
      expect(executionLog.error).toBeInstanceOf(Error);

      const plainLog: ExecutionLog = {};
      handleTesterAttemptError(
        { code: -301, data: `Resolve(Dead(OutPoint(0x${"11".repeat(32)}00000000)))` },
        plainLog,
      );
      expect(plainLog.error).toEqual({
        code: -301,
        data: `Resolve(Dead(OutPoint(0x${"11".repeat(32)}00000000)))`,
      });
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("records deterministic failures with exit 1", () => {
    const originalExitCode = process.exitCode;
    try {
      process.exitCode = 2;
      const executionLog: ExecutionLog = { startTime: "fixture" };

      handleTesterAttemptError(
        new Error("SDK conversion failed: deterministic fixture"),
        executionLog,
      );

      expect(process.exitCode).toBe(1);
      expect(executionLog.error).toMatchObject({
        message: "SDK conversion failed: deterministic fixture",
      });
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
      const executionLog: ExecutionLog = { startTime: "fixture" };

      stopForLowTesterCapital(executionLog);

      expect(process.exitCode).toBe(2);
      expect(executionLog.error).toBe(
        "Not enough funds to continue testing, shutting down...",
      );
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});
