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

describe(SEND_AND_WAIT_SUITE, () => {
  it("treats post-broadcast polling failures as unconfirmed", async () => {
    const txHash = hash("a4");
    const onSent = vi.fn();
    const onConfirmationWait = vi.fn();
    const onLifecycle = vi.fn<(event: SendAndWaitForCommitEvent) => void>();
    const sleep = vi.fn(noopAsync);
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("RPC down"))
      .mockResolvedValueOnce(transactionStatus("committed"));

    await expect(
      sendAndWaitForCommit(
        {
          client: new TransactionStatusStubClient(request),
          signer: signerWithSendTransaction(vi.fn().mockResolvedValue(txHash)),
        },
        ccc.Transaction.default(),
        {
          onConfirmationWait: () => {
            onConfirmationWait();
          },
          onLifecycle,
          onSent: (sentTxHash) => {
            onSent(sentTxHash);
          },
          sleep,
        },
      ),
    ).resolves.toBe(txHash);

    expect(onSent).toHaveBeenCalledWith(txHash);
    expect(onConfirmationWait).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(onLifecycle.mock.calls.map(([event]) => event)).toMatchObject([
      { type: "broadcasted", txHash },
      { type: "committed", txHash, status: "committed", checks: 2 },
    ]);
  });
});
