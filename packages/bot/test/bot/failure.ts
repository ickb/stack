import { STOP_EXIT_CODE } from "@ickb/node-utils";
import { TransactionBroadcastError } from "@ickb/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { handleTurnFailure } from "../../src/bot/failure.ts";
import { isRetryableBotError } from "../../src/index.ts";

const FETCH_FAILED = "fetch failed";
const DETERMINISTIC_BUILD_FAILURE = "deterministic build failure";
const TRANSACTION_CONFIRMATION_ERROR = "TransactionConfirmationError";
const REJECTED_STATUS = "rejected";
const TX_HASH = `0x${"11".repeat(32)}`;
const RBF_REJECTED_REASON = JSON.stringify({
  type: "RBFRejected",
  description: `RBF rejected: replaced by tx Byte32(0x${"22".repeat(32)})`,
});

afterEach(() => {
  process.exitCode = undefined;
});

describe("bot iteration failure metadata", () => {
  it("treats transport and CKB state-race failures as retryable", () => {
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

describe("bot post-broadcast confirmation outcomes", () => {
  it("never retries outcomes other than an RBF replacement", () => {
    expect(
      isRetryableBotError(
        confirmationError({ reason: undefined, status: "pending", isTimeout: true }),
      ),
    ).toBe(false);
    expect(
      isRetryableBotError(
        confirmationError({
          reason: RBF_REJECTED_REASON,
          status: "pending",
          isTimeout: true,
        }),
      ),
    ).toBe(false);
    expect(
      isRetryableBotError(
        confirmationError({
          reason: undefined,
          status: "unresolved",
          cause: new TypeError(FETCH_FAILED),
        }),
      ),
    ).toBe(false);
  });
});

describe("bot failure exit codes", () => {
  it("holds the service after a confirmation timeout", () => {
    const events = handleFailure(
      confirmationError({ reason: undefined, status: "pending", isTimeout: true }),
    );

    // A restart would rebuild and resend a transaction that may still commit.
    expect(process.exitCode).toBe(STOP_EXIT_CODE);
    expect(events.at(-1)).toMatchObject({
      type: "bot.turn.failed",
      fields: { retryable: false, terminal: true },
    });
  });

  it("holds the service when transport hid the confirmation outcome", () => {
    handleFailure(
      confirmationError({
        reason: undefined,
        status: "unresolved",
        cause: new TypeError(FETCH_FAILED),
      }),
    );

    expect(process.exitCode).toBe(STOP_EXIT_CODE);
  });

  it("lets the next turn rebuild after an RBF confirmation rejection", () => {
    const events = handleFailure(rbfConfirmationError());

    expect(process.exitCode).toBe(1);
    expect(events.at(-1)).toMatchObject({
      fields: {
        retryable: true,
        terminal: false,
        error: {
          name: TRANSACTION_CONFIRMATION_ERROR,
          txHash: TX_HASH,
          status: REJECTED_STATUS,
          isTimeout: false,
          reason: RBF_REJECTED_REASON,
        },
      },
    });
    expect(events.at(-1)?.fields?.["error"]).not.toHaveProperty("stack");
  });

  it("holds the service after a node transaction hash mismatch", () => {
    handleFailure(
      new TransactionBroadcastError(`0x${"11".repeat(32)}`, {
        nodeTxHash: `0x${"22".repeat(32)}`,
        cause: new TypeError(FETCH_FAILED),
      }),
    );

    // The node accepted something under a hash this attempt cannot bind, so the
    // local transaction may already be in the pool.
    expect(process.exitCode).toBe(STOP_EXIT_CODE);
  });

  it("exits 1 for transient failures without a stack and for deterministic ones with", () => {
    const transient = handleFailure(wrappedTransactionHeaderFetchFailure());
    expect(process.exitCode).toBe(1);
    expect(transient.at(-1)).toMatchObject({
      fields: { retryable: true, terminal: false },
    });
    expect(transient.at(-1)?.fields?.["error"]).not.toHaveProperty("stack");

    const deterministic = handleFailure(new Error(DETERMINISTIC_BUILD_FAILURE));
    expect(process.exitCode).toBe(1);
    expect(deterministic.at(-1)).toMatchObject({
      fields: {
        retryable: false,
        terminal: true,
        error: { name: "Error", message: DETERMINISTIC_BUILD_FAILURE },
      },
    });
    expect(deterministic.at(-1)?.fields?.["error"]).toHaveProperty("stack");
  });
});

function handleFailure(
  error: unknown,
): Array<{ type: string; fields: Record<string, unknown> | undefined }> {
  const events: Array<{ type: string; fields: Record<string, unknown> | undefined }> = [];
  handleTurnFailure(
    {
      emit: (type: "bot.turn.failed", fields?: Record<string, unknown>): void => {
        events.push({ type, fields });
      },
    },
    error,
  );
  return events;
}

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

function confirmationError({
  reason,
  status = REJECTED_STATUS,
  isTimeout = false,
  cause,
}: {
  reason: string | undefined;
  status?: string;
  isTimeout?: boolean;
  cause?: unknown;
}): Error {
  const error = Object.assign(
    new Error(`Transaction ended with status: ${status}`, {
      cause,
    }),
    {
      txHash: TX_HASH,
      status,
      isTimeout,
      reason,
    },
  );
  Object.defineProperty(error, "name", { value: TRANSACTION_CONFIRMATION_ERROR });
  return error;
}
