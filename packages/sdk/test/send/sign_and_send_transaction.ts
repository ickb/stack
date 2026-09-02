import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { script } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import { signAndSendTransaction } from "../../src/sdk.ts";
import { hash } from "../transaction/base/support/sdk_core_support.ts";

const TX_HASH = hash("81");
const INPUT_OUT_POINT = { txHash: hash("91"), index: 0n };
const ALTERED_BODY_ERROR =
  "Signer altered the transaction inputs, outputs or outputs data";

describe("signAndSendTransaction", () => {
  it("records signed chain identity before RPC and never marks the cache", async () => {
    const signed = bodyTransaction();
    const { signer, signedHash, getCell, send, mark } = signerFixture(signed);
    const calls: string[] = [];
    signedHash.mockImplementation(() => {
      calls.push("hash");
      return TX_HASH;
    });
    getCell.mockImplementation(async (outPoint) => {
      await Promise.resolve();
      calls.push("getCell");
      return inputCell(outPoint, 100n);
    });
    send.mockImplementation(async () => {
      await Promise.resolve();
      calls.push("send");
      return TX_HASH;
    });

    await expect(
      signAndSendTransaction(signer, bodyTransaction(), (txHash) => {
        expect(txHash).toBe(TX_HASH);
        calls.push("record");
      }),
    ).resolves.toBe(TX_HASH);

    expect(calls).toEqual(["hash", "getCell", "record", "send"]);
    expect(mark).not.toHaveBeenCalled();
  });

  it("rejects an excessive signed fee rate before recording or broadcast", async () => {
    const signed = bodyTransaction();
    const { signer, getCell, send } = signerFixture(signed);
    const recordTxHash = vi.fn<(txHash: ccc.Hex) => void>();
    getCell.mockResolvedValueOnce(
      inputCell(INPUT_OUT_POINT, 100n + cccA.DEFAULT_MAX_FEE_RATE * 10_000n),
    );

    await expect(
      signAndSendTransaction(signer, bodyTransaction(), recordTxHash),
    ).rejects.toBeInstanceOf(ccc.ErrorClientMaxFeeRateExceeded);

    expect(recordTxHash).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("signAndSendTransaction economic body", () => {
  it("accepts signer-owned witness and dependency preparation", async () => {
    const requested = bodyTransaction();
    const prepared = bodyTransaction();
    prepared.witnesses = ["0xaa"];
    prepared.cellDeps = [
      ccc.CellDep.from({
        outPoint: { txHash: hash("93"), index: 0n },
        depType: "depGroup",
      }),
    ];
    prepared.headerDeps = [hash("94")];
    const { signer } = signerFixture(prepared);

    await expect(signAndSendTransaction(signer, requested)).resolves.toBe(TX_HASH);
  });

  it("rejects a connector-added output before fee inspection or broadcast", async () => {
    const altered = bodyTransaction();
    altered.outputs.push(ccc.CellOutput.from({ capacity: 200n, lock: script("22") }));
    altered.outputsData.push("0x");
    const { signer, getCell, send } = signerFixture(altered);
    const recordTxHash = vi.fn<(txHash: ccc.Hex) => void>();

    await expect(
      signAndSendTransaction(signer, bodyTransaction(), recordTxHash),
    ).rejects.toThrow(ALTERED_BODY_ERROR);

    expect(getCell).not.toHaveBeenCalled();
    expect(recordTxHash).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an in-place edit of the requested outputs data", async () => {
    const requested = bodyTransaction();
    const { signer, send, signTransaction } = signerFixture(requested);
    signTransaction.mockImplementation(async () => {
      await Promise.resolve();
      requested.outputsData[0] = "0x02";
      return requested;
    });

    await expect(signAndSendTransaction(signer, requested)).rejects.toThrow(
      ALTERED_BODY_ERROR,
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a connector change to an input since value", async () => {
    const altered = bodyTransaction();
    for (const input of altered.inputs) {
      input.since = 1n;
    }
    const { signer, send } = signerFixture(altered);

    await expect(signAndSendTransaction(signer, bodyTransaction())).rejects.toThrow(
      ALTERED_BODY_ERROR,
    );

    expect(send).not.toHaveBeenCalled();
  });

  it("values inputs before signing when connector metadata understates the fee", async () => {
    const requested = bodyTransaction(100n + cccA.DEFAULT_MAX_FEE_RATE * 10_000n);
    const signed = bodyTransaction(100n);
    const { signer, getCell, send } = signerFixture(signed);
    const recordTxHash = vi.fn<(txHash: ccc.Hex) => void>();

    await expect(
      signAndSendTransaction(signer, requested, recordTxHash),
    ).rejects.toBeInstanceOf(ccc.ErrorClientMaxFeeRateExceeded);

    expect(getCell).not.toHaveBeenCalled();
    expect(recordTxHash).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

function bodyTransaction(inputCapacity?: bigint): ccc.Transaction {
  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: INPUT_OUT_POINT }],
    outputs: [{ capacity: 100n, lock: script("11") }],
    outputsData: ["0x01"],
  });
  if (inputCapacity !== undefined) {
    for (const input of tx.inputs) {
      input.cellOutput = plainCellOutput(inputCapacity);
      input.outputData = "0x";
    }
  }
  return tx;
}

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

function signerFixture(signed = ccc.Transaction.default()): {
  signer: ccc.Signer;
  signedHash: ReturnType<typeof vi.fn<() => ccc.Hex>>;
  getCell: ReturnType<
    typeof vi.fn<(outPoint: ccc.OutPointLike) => Promise<ccc.Cell | undefined>>
  >;
  send: ReturnType<typeof vi.fn<(tx: ccc.TransactionLike) => Promise<ccc.Hex>>>;
  mark: ReturnType<typeof vi.fn<(tx: ccc.TransactionLike) => Promise<void>>>;
  signTransaction: ReturnType<typeof vi.fn<() => Promise<ccc.Transaction>>>;
} {
  const signedHash = vi.spyOn(signed, "hash").mockReturnValue(TX_HASH);
  const getCell = vi.fn(async (outPoint: ccc.OutPointLike) => {
    await Promise.resolve();
    return inputCell(outPoint, 100n);
  });
  const send = vi.fn(async () => {
    await Promise.resolve();
    return TX_HASH;
  });
  const mark = vi.fn(async () => {
    await Promise.resolve();
  });
  const client = {
    getCell,
    // CCC resolves the Nervos DAO script while checking inputs for withdrawal profit.
    getKnownScript: vi.fn(async () => {
      await Promise.resolve();
      return { codeHash: hash("90"), hashType: "type", cellDeps: [] };
    }),
    sendTransactionNoCache: send,
    cache: { markTransactions: mark },
  };
  const signTransaction = vi.fn(async () => {
    await Promise.resolve();
    return signed;
  });
  const signer = { client, signTransaction };
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Focused fixture supplies only the public signer/client methods under test.
    signer: signer as unknown as ccc.Signer,
    signedHash,
    getCell,
    send,
    mark,
    signTransaction,
  };
}

function inputCell(outPoint: ccc.OutPointLike, capacity: bigint): ccc.Cell {
  return ccc.Cell.from({
    outPoint,
    cellOutput: plainCellOutput(capacity),
    outputData: "0x",
  });
}

function plainCellOutput(capacity: bigint): ccc.CellOutput {
  return ccc.CellOutput.from({ capacity, lock: script("11") });
}
