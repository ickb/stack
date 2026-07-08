import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAndWaitForCommit, type SendAndWaitForCommitEvent } from "../../src/sdk.ts";
import { signerWithSendTransaction } from "../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { hash } from "../transaction/base/support/sdk_core_support.ts";
import {
  noopAsync,
  SEND_AND_WAIT_SUITE,
  transactionStatus,
  TransactionStatusStubClient,
} from "./support/sdk_send_wait_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const SEND_AND_WAIT_REJECT = "Expected sendAndWaitForCommit to reject";

const TRANSACTION_CONFIRMATION_TIMED_OUT = "Transaction confirmation timed out";

describe(SEND_AND_WAIT_SUITE, () => {
  it("surfaces transaction confirmation timeouts with the broadcast hash", async () => {
    const txHash = hash("a3");
    const onSent = vi.fn();
    const sleep = vi.fn(noopAsync);
    const onLifecycle = vi.fn<(event: SendAndWaitForCommitEvent) => void>();

    let caught: unknown;
    try {
      await sendAndWaitForCommit(
        {
          client: new TransactionStatusStubClient(
            vi.fn().mockResolvedValue(transactionStatus("unknown")),
          ),
          signer: signerWithSendTransaction(vi.fn().mockResolvedValue(txHash)),
        },
        ccc.Transaction.default(),
        {
          maxConfirmationChecks: 1,
          onLifecycle,
          onSent: (sentTxHash) => {
            onSent(sentTxHash);
          },
          sleep,
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught ?? new Error(SEND_AND_WAIT_REJECT)).toBeInstanceOf(Error);
    expect(caught).toMatchObject({ name: "TransactionConfirmationError" });
    expect(caught).toMatchObject({
      message: TRANSACTION_CONFIRMATION_TIMED_OUT,
      txHash,
      status: "unknown",
      isTimeout: true,
    });

    expect(onSent).toHaveBeenCalledWith(txHash);
    expect(sleep).not.toHaveBeenCalled();
    expect(onLifecycle.mock.calls.map(([event]) => event)).toMatchObject([
      { type: "broadcasted", txHash },
      { type: "timeout_after_broadcast", txHash, status: "unknown", checks: 1 },
    ]);
  });
});
