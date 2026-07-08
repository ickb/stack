import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAndWaitForCommit, type SendAndWaitForCommitEvent } from "../../src/sdk.ts";
import { signerWithSendTransaction } from "../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { hash } from "../transaction/base/support/sdk_core_support.ts";
import {
  ClearableCache,
  noopAsync,
  SEND_AND_WAIT_SUITE,
  transactionStatus,
  TransactionStatusStubClient,
} from "./support/sdk_send_wait_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const SEND_AND_WAIT_REJECT = "Expected sendAndWaitForCommit to reject";

describe(SEND_AND_WAIT_SUITE, () => {
  it("surfaces status-only terminal transaction failures and clears cache", async () => {
    const txHash = hash("a2");
    const reason =
      "Resolve failed Dead(OutPoint(0xabc000000000000000000000000000000000000000000000000000000000000000000000))";
    const sleep = vi.fn(noopAsync);
    const onLifecycle = vi.fn<(event: SendAndWaitForCommitEvent) => void>();
    const request = vi.fn().mockResolvedValue(transactionStatus("rejected", reason));
    const clear = vi.fn(noopAsync);

    let caught: unknown;
    try {
      await sendAndWaitForCommit(
        {
          client: new TransactionStatusStubClient(request, new ClearableCache(clear)),
          signer: signerWithSendTransaction(vi.fn().mockResolvedValue(txHash)),
        },
        ccc.Transaction.default(),
        { onLifecycle, sleep },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught ?? new Error(SEND_AND_WAIT_REJECT)).toBeInstanceOf(Error);
    expect(caught).toMatchObject({ name: "TransactionConfirmationError" });
    expect(caught).toMatchObject({
      message: `Transaction ended with status: rejected: ${reason}`,
      txHash,
      status: "rejected",
      isTimeout: false,
      reason,
    });

    expect(clear).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(onLifecycle.mock.calls.map(([event]) => event)).toMatchObject([
      { type: "broadcasted", txHash },
      {
        type: "terminal_rejection",
        txHash,
        status: "rejected",
        reason,
        checks: 1,
      },
    ]);
  });

  it("formats terminal transaction failures without a reason", async () => {
    const txHash = hash("a3");
    const request = vi.fn().mockResolvedValue(transactionStatus("rejected"));
    const clear = vi.fn(noopAsync);

    await expect(
      sendAndWaitForCommit(
        {
          client: new TransactionStatusStubClient(request, new ClearableCache(clear)),
          signer: signerWithSendTransaction(vi.fn().mockResolvedValue(txHash)),
        },
        ccc.Transaction.default(),
      ),
    ).rejects.toMatchObject({
      message: "Transaction ended with status: rejected",
      txHash,
      status: "rejected",
      isTimeout: false,
    });

    expect(clear).toHaveBeenCalledTimes(1);
  });
});
