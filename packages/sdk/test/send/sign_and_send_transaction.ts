import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { describe, expect, it, vi } from "vitest";
import { signAndSendTransaction } from "../../src/sdk.ts";
import { hash } from "../transaction/base/support/sdk_core_support.ts";

const TX_HASH = hash("81");

describe("signAndSendTransaction", () => {
  it("records signed chain identity before RPC and never marks the cache", async () => {
    const { signer, signedHash, feeRate, send, mark } = signerFixture();
    const calls: string[] = [];
    signedHash.mockImplementation(() => {
      calls.push("hash");
      return TX_HASH;
    });
    feeRate.mockImplementation(async (client) => {
      await Promise.resolve();
      expect(client).toBe(signer.client);
      calls.push("feeRate");
      return cccA.DEFAULT_MAX_FEE_RATE;
    });
    send.mockImplementation(async () => {
      await Promise.resolve();
      calls.push("send");
      return TX_HASH;
    });

    await expect(
      signAndSendTransaction(signer, ccc.Transaction.default(), (txHash) => {
        expect(txHash).toBe(TX_HASH);
        calls.push("record");
      }),
    ).resolves.toBe(TX_HASH);

    expect(calls).toEqual(["hash", "feeRate", "record", "send"]);
    expect(mark).not.toHaveBeenCalled();
  });

  it("rejects an excessive signed fee rate before recording or broadcast", async () => {
    const { signer, feeRate, send } = signerFixture();
    const recordTxHash = vi.fn<(txHash: ccc.Hex) => void>();
    feeRate.mockResolvedValueOnce(cccA.DEFAULT_MAX_FEE_RATE + 1n);

    await expect(
      signAndSendTransaction(signer, ccc.Transaction.default(), recordTxHash),
    ).rejects.toBeInstanceOf(ccc.ErrorClientMaxFeeRateExceeded);

    expect(recordTxHash).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("signAndSendTransaction broadcast outcomes", () => {
  it("accepts a duplicate submission naming the same transaction", async () => {
    const { signer, send } = signerFixture();
    send.mockRejectedValueOnce(duplicatedTransaction(TX_HASH));

    await expect(signAndSendTransaction(signer, ccc.Transaction.default())).resolves.toBe(
      TX_HASH,
    );
  });

  it("fails closed on a duplicate submission naming another transaction", async () => {
    const { signer, send } = signerFixture();
    const nodeTxHash = hash("82");
    send.mockRejectedValueOnce(duplicatedTransaction(nodeTxHash));

    await expect(
      signAndSendTransaction(signer, ccc.Transaction.default()),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "TransactionBroadcastError",
        txHash: TX_HASH,
        nodeTxHash,
      }),
    );
  });

  it("throws a public hash-preserving error when send is ambiguous", async () => {
    const { signer, send } = signerFixture();
    const transportError = new TypeError("fetch failed");
    send.mockRejectedValueOnce(transportError);

    await expect(
      signAndSendTransaction(signer, ccc.Transaction.default()),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "TransactionBroadcastError",
        txHash: TX_HASH,
        nodeTxHash: undefined,
        cause: transportError,
      }),
    );
  });

  it("preserves local identity when the node returns an inconsistent hash", async () => {
    const { signer, send } = signerFixture();
    const nodeTxHash = hash("82");
    send.mockResolvedValueOnce(nodeTxHash);

    await expect(
      signAndSendTransaction(signer, ccc.Transaction.default()),
    ).rejects.toEqual(
      expect.objectContaining({
        txHash: TX_HASH,
        nodeTxHash,
      }),
    );
  });
});

function duplicatedTransaction(txHash: ccc.Hex): ccc.ErrorClientDuplicatedTransaction {
  return new ccc.ErrorClientDuplicatedTransaction(
    { code: -1107, data: `Duplicated(Byte32(${txHash}))` },
    txHash,
  );
}

function signerFixture(): {
  signer: ccc.Signer;
  signedHash: ReturnType<typeof vi.fn<() => ccc.Hex>>;
  feeRate: ReturnType<typeof vi.fn<(client: ccc.Client) => Promise<ccc.Num>>>;
  send: ReturnType<typeof vi.fn<(tx: ccc.TransactionLike) => Promise<ccc.Hex>>>;
  mark: ReturnType<typeof vi.fn<(tx: ccc.TransactionLike) => Promise<void>>>;
} {
  const signed = ccc.Transaction.default();
  const signedHash = vi.spyOn(signed, "hash").mockReturnValue(TX_HASH);
  const feeRate = vi
    .spyOn(signed, "getFeeRate")
    .mockResolvedValue(cccA.DEFAULT_MAX_FEE_RATE);
  const send = vi.fn(async () => {
    await Promise.resolve();
    return TX_HASH;
  });
  const mark = vi.fn(async () => {
    await Promise.resolve();
  });
  const client = {
    sendTransactionNoCache: send,
    cache: { markTransactions: mark },
  };
  const signer = {
    client,
    signTransaction: vi.fn(async () => {
      await Promise.resolve();
      return signed;
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Focused fixture supplies only the public signer/client methods under test.
  return { signer: signer as unknown as ccc.Signer, signedHash, feeRate, send, mark };
}
