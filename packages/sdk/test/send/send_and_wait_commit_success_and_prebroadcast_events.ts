import { ccc } from "@ckb-ccc/core";
import { StubClient } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAndWaitForCommit, type SendAndWaitForCommitEvent } from "../../src/sdk.ts";
import { signerWithSendTransaction } from "../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { baseClient, hash } from "../transaction/base/support/sdk_core_support.ts";
import {
  ClearableCache,
  noopAsync,
  NoRequestorStubClient,
  SEND_AND_WAIT_SUITE,
  transactionStatus,
  TransactionStatusStubClient,
} from "./support/sdk_send_wait_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(SEND_AND_WAIT_SUITE, () => {
  it("waits for a sent transaction to commit before returning the hash", async () => {
    const txHash = hash("a1");
    const sleep = vi.fn(noopAsync);
    const onConfirmationWait = vi.fn();
    const onLifecycle = vi.fn<(event: SendAndWaitForCommitEvent) => void>();
    const sendTransaction = vi.fn().mockResolvedValue(txHash);
    const request = vi
      .fn()
      .mockResolvedValueOnce(transactionStatus("pending"))
      .mockResolvedValueOnce(transactionStatus("unknown"))
      .mockResolvedValueOnce(transactionStatus("committed"));

    await expect(
      sendAndWaitForCommit(
        {
          client: new TransactionStatusStubClient(request),
          signer: signerWithSendTransaction(sendTransaction),
        },
        ccc.Transaction.default(),
        {
          confirmationIntervalMs: 7,
          onConfirmationWait: () => {
            onConfirmationWait();
          },
          onLifecycle,
          sleep,
        },
      ),
    ).resolves.toBe(txHash);

    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(onConfirmationWait).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(7);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenCalledWith("get_transaction", [txHash, "0x1"]);
    expect(onLifecycle.mock.calls.map(([event]) => event)).toMatchObject([
      { type: "broadcasted", txHash },
      { type: "committed", txHash, status: "committed", checks: 3 },
    ]);
  });
});

describe(`${SEND_AND_WAIT_SUITE} failure events`, () => {
  it("emits pre-broadcast lifecycle failures without changing the thrown error", async () => {
    const error = new Error("broadcast failed");
    const onLifecycle = vi.fn<(event: SendAndWaitForCommitEvent) => void>();

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

    expect(onLifecycle.mock.calls.map(([event]) => event)).toMatchObject([
      { type: "pre_broadcast_failed", error },
    ]);
  });
});

describe(`${SEND_AND_WAIT_SUITE} polling responses`, () => {
  it("requires a JSON-RPC requestor after broadcast", async () => {
    const txHash = hash("a9");

    await expect(
      sendAndWaitForCommit(
        {
          client: new NoRequestorStubClient(),
          signer: signerWithSendTransaction(vi.fn().mockResolvedValue(txHash)),
        },
        ccc.Transaction.default(),
      ),
    ).rejects.toThrow("sendAndWaitForCommit requires a JSON-RPC client requestor");
  });

  it("requires the JSON-RPC requestor to expose a request function", async () => {
    const txHash = hash("ad");
    const client = new StubClient();
    Object.defineProperty(client, "requestor", { value: {} });

    await expect(
      sendAndWaitForCommit(
        {
          client,
          signer: signerWithSendTransaction(vi.fn().mockResolvedValue(txHash)),
        },
        ccc.Transaction.default(),
      ),
    ).rejects.toThrow("sendAndWaitForCommit requires a JSON-RPC client requestor");
  });

  it("treats malformed transaction status responses as pending", async () => {
    const txHash = hash("aa");
    const request = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ tx_status: [] })
      .mockResolvedValueOnce(transactionStatus("committed"));

    await expect(
      sendAndWaitForCommit(
        {
          client: new TransactionStatusStubClient(request),
          signer: signerWithSendTransaction(vi.fn().mockResolvedValue(txHash)),
        },
        ccc.Transaction.default(),
        { confirmationIntervalMs: 0, sleep: noopAsync },
      ),
    ).resolves.toBe(txHash);

    expect(request).toHaveBeenCalledTimes(3);
  });

  it("treats non-string statuses as unknown while polling", async () => {
    const txHash = hash("ab");
    const request = vi
      .fn()
      .mockResolvedValueOnce({ tx_status: { status: 1 } })
      .mockResolvedValueOnce(transactionStatus("committed"));

    await expect(
      sendAndWaitForCommit(
        {
          client: new TransactionStatusStubClient(request),
          signer: signerWithSendTransaction(vi.fn().mockResolvedValue(txHash)),
        },
        ccc.Transaction.default(),
        { confirmationIntervalMs: 0, sleep: noopAsync },
      ),
    ).resolves.toBe(txHash);
  });
});

describe(`${SEND_AND_WAIT_SUITE} terminal rejections`, () => {
  it("emits terminal rejection details and clears cached transaction state", async () => {
    const txHash = hash("ac");
    const clear = vi.fn(noopAsync);
    const request = vi.fn().mockResolvedValue(transactionStatus("rejected", "bad tx"));
    const onLifecycle = vi.fn<(event: SendAndWaitForCommitEvent) => void>();
    const client = new TransactionStatusStubClient(request, new ClearableCache(clear));

    await expect(
      sendAndWaitForCommit(
        {
          client,
          signer: signerWithSendTransaction(vi.fn().mockResolvedValue(txHash)),
        },
        ccc.Transaction.default(),
        { onLifecycle },
      ),
    ).rejects.toMatchObject({
      txHash,
      status: "rejected",
      reason: "bad tx",
      isTimeout: false,
    });

    expect(clear).toHaveBeenCalledTimes(1);
    expect(onLifecycle.mock.calls.map(([event]) => event)).toMatchObject([
      { type: "broadcasted", txHash },
      { type: "terminal_rejection", txHash, status: "rejected", reason: "bad tx" },
    ]);
  });
});
