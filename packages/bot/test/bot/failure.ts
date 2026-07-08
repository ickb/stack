import { describe, expect, it } from "vitest";
import {
  isRetryableBotError,
  iterationFailureEventFields,
  nonRetryableTerminalFailureExitCode,
} from "../../src/index.ts";

const FETCH_FAILED = "fetch failed";
const DETERMINISTIC_BUILD_FAILURE = "deterministic build failure";
const TRANSACTION_CONFIRMATION_ERROR = "TransactionConfirmationError";
const REJECTED_STATUS = "rejected";
const TX_HASH = `0x${"11".repeat(32)}`;
const RBF_REJECTED_REASON = JSON.stringify({
  type: "RBFRejected",
  description: `RBF rejected: replaced by tx Byte32(0x${"22".repeat(32)})`,
});

describe("bot iteration failure metadata", () => {
  it("treats transport and CKB state-race failures as retryable", () => {
    expect(
      isRetryableBotError(
        new Error("L1 state scan crossed chain tip; retry with a fresh state"),
      ),
    ).toBe(true);
    expect(isRetryableBotError(new TypeError(FETCH_FAILED))).toBe(true);
    expect(
      isRetryableBotError(
        new Error(FETCH_FAILED, { cause: new TypeError(FETCH_FAILED) }),
      ),
    ).toBe(true);
    expect(isRetryableBotError(wrappedTransactionHeaderFetchFailure())).toBe(true);
    expect(isRetryableBotError(new Error("Id mismatched, got null, expected 319"))).toBe(
      true,
    );
    expect(
      isRetryableBotError(
        new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"),
      ),
    ).toBe(true);
    expect(
      isRetryableBotError(
        Object.assign(new Error("Client request error PoolRejectedRBF"), {
          code: -1111,
          data: 'RBFRejected("Tx\'s current fee is 11795, expect it to >= 12326 to replace old txs")',
        }),
      ),
    ).toBe(true);
    expect(
      isRetryableBotError(
        Object.assign(new Error("Client request error TransactionFailedToResolve"), {
          code: -301,
          data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))`,
        }),
      ),
    ).toBe(true);
    expect(
      isRetryableBotError({
        code: -301,
        data: `Resolve(Dead(OutPoint(0x${"11".repeat(32)}00000000)))`,
      }),
    ).toBe(true);
    expect(
      isRetryableBotError(
        Object.assign(
          new Error("Client request error PoolRejectedDuplicatedTransaction"),
          {
            code: -1107,
            data: `Duplicated(Byte32(0x${"22".repeat(32)}))`,
          },
        ),
      ),
    ).toBe(true);
    expect(isRetryableBotError(new Error(FETCH_FAILED))).toBe(false);
    expect(
      isRetryableBotError({ code: -301, data: "Resolve(InvalidHeader(Byte32(0x...)))" }),
    ).toBe(false);
    expect(isRetryableBotError(new Error(DETERMINISTIC_BUILD_FAILURE))).toBe(false);
  });

  it("treats post-broadcast RBF confirmation rejection as retryable", () => {
    expect(isRetryableBotError(rbfConfirmationError())).toBe(true);
    expect(
      isRetryableBotError(
        confirmationError({ reason: "Resolve failed Dead(OutPoint(...))" }),
      ),
    ).toBe(false);
    expect(isRetryableBotError(confirmationError({ reason: undefined }))).toBe(false);
  });
});

describe("bot retryable iteration failures", () => {
  it("emits retryability metadata from the same retry decision", () => {
    expect(iterationFailureEventFields(new TypeError(FETCH_FAILED))).toMatchObject({
      retryable: true,
      terminal: false,
      error: { name: "TypeError", message: FETCH_FAILED },
    });
    expect(
      iterationFailureEventFields(new TypeError(FETCH_FAILED)).error,
    ).not.toHaveProperty("stack");

    const responseShapeFailure = iterationFailureEventFields(
      new Error("Id mismatched, got null, expected 319"),
    );
    expect(responseShapeFailure).toMatchObject({ retryable: true, terminal: false });
    expect(responseShapeFailure.error).not.toHaveProperty("stack");

    const wrappedTransportFailure = iterationFailureEventFields(
      wrappedTransactionHeaderFetchFailure(),
    );
    expect(wrappedTransportFailure).toMatchObject({ retryable: true, terminal: false });
    expect(wrappedTransportFailure.error).not.toHaveProperty("stack");

    const exhaustedFailure = iterationFailureEventFields(new TypeError(FETCH_FAILED), {
      retryableAttempts: 3,
      maxRetryableAttempts: 3,
    });
    expect(exhaustedFailure).toMatchObject({
      retryable: true,
      terminal: true,
      retryableAttempts: 3,
      maxRetryableAttempts: 3,
      retryBudgetExhausted: true,
    });
    expect(exhaustedFailure.error).not.toHaveProperty("stack");

    expect(
      iterationFailureEventFields(new TypeError(FETCH_FAILED), {
        retryableAttempts: 3,
        maxRetryableAttempts: undefined,
      }),
    ).toMatchObject({ retryable: true, terminal: false, retryableAttempts: 3 });

    const terminalFailure = iterationFailureEventFields(
      new Error(DETERMINISTIC_BUILD_FAILURE),
    );
    expect(terminalFailure).toMatchObject({
      retryable: false,
      terminal: true,
      error: { name: "Error", message: DETERMINISTIC_BUILD_FAILURE },
    });
    expect(terminalFailure.error).toHaveProperty("stack");
    expect(nonRetryableTerminalFailureExitCode(terminalFailure)).toBe(1);
    expect(nonRetryableTerminalFailureExitCode(exhaustedFailure)).toBeUndefined();
  });

  it("emits retryable metadata for post-broadcast RBF confirmation rejection", () => {
    const rbfConfirmationFailure = iterationFailureEventFields(rbfConfirmationError());

    expect(rbfConfirmationFailure).toMatchObject({
      retryable: true,
      terminal: false,
      error: {
        name: TRANSACTION_CONFIRMATION_ERROR,
        txHash: TX_HASH,
        status: REJECTED_STATUS,
        isTimeout: false,
        reason: RBF_REJECTED_REASON,
      },
    });
    expect(rbfConfirmationFailure.error).not.toHaveProperty("stack");
  });
});

function rbfConfirmationError(): Error {
  return confirmationError({ reason: RBF_REJECTED_REASON });
}

function wrappedTransactionHeaderFetchFailure(): Error {
  return new Error(
    `Failed to load transaction header for txHash ${TX_HASH} at ${TX_HASH}00000000`,
    {
      cause: new TypeError(FETCH_FAILED),
    },
  );
}

function confirmationError({ reason }: { reason: string | undefined }): Error {
  const error = Object.assign(new Error("Transaction ended with status: rejected"), {
    txHash: TX_HASH,
    status: REJECTED_STATUS,
    isTimeout: false,
    reason,
  });
  Object.defineProperty(error, "name", { value: TRANSACTION_CONFIRMATION_ERROR });
  return error;
}
