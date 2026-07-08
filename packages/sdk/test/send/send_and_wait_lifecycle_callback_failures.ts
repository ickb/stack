import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAndWaitForCommit, type SendAndWaitForCommitEvent } from "../../src/sdk.ts";
import { signerWithSendTransaction } from "../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { baseClient, hash } from "../transaction/base/support/sdk_core_support.ts";
import {
  SEND_AND_WAIT_SUITE,
  transactionStatus,
  TransactionStatusStubClient,
} from "./support/sdk_send_wait_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(SEND_AND_WAIT_SUITE, () => {
  it("does not let lifecycle callback failures replace send errors", async () => {
    const error = new Error("broadcast failed");
    const onLifecycle = vi.fn<(event: SendAndWaitForCommitEvent) => void>(() => {
      throw new Error("observer failed");
    });

    await expect(
      sendAndWaitForCommit(
        {
          client: baseClient,
          signer: signerWithSendTransaction(vi.fn().mockRejectedValue(error)),
        },
        ccc.Transaction.default(),
        { onLifecycle },
      ),
    ).rejects.toBe(error);

    expect(onLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pre_broadcast_failed",
        error,
      }),
    );
  });

  it("does not let lifecycle callback failures interrupt confirmation", async () => {
    const txHash = hash("a7");
    const onSent = vi.fn();
    const onLifecycle = vi.fn<(event: SendAndWaitForCommitEvent) => void>(() => {
      throw new Error("observer failed");
    });

    await expect(
      sendAndWaitForCommit(
        {
          client: new TransactionStatusStubClient(
            vi.fn().mockResolvedValue(transactionStatus("committed")),
          ),
          signer: signerWithSendTransaction(vi.fn().mockResolvedValue(txHash)),
        },
        ccc.Transaction.default(),
        {
          onLifecycle,
          onSent: (sentTxHash) => {
            onSent(sentTxHash);
          },
        },
      ),
    ).resolves.toBe(txHash);

    expect(onSent).toHaveBeenCalledWith(txHash);
    expect(onLifecycle.mock.calls.map(([event]) => event)).toMatchObject([
      { type: "broadcasted", txHash },
      { type: "committed", txHash, status: "committed", checks: 1 },
    ]);
  });
});
