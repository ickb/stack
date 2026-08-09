import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  signerWithLock,
  testSdk,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { hash, transactionWithOutputs } from "../base/support/sdk_core_support.ts";
import { COMPLETE_TRANSACTION_SUITE } from "./support/sdk_suite_titles.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(COMPLETE_TRANSACTION_SUITE, () => {
  it("rebuilds a clean transaction before fee-change fallback", async () => {
    const { sdk, ickbUdt, logicManager, lock } = testSdk();
    const tx = ccc.Transaction.default();
    tx.addOutput({ lock, type: logicManager.script }, "0x");
    const signer = signerWithLock(lock);
    const dirtyTx = tx.clone();
    dirtyTx.addInput({
      previousOutput: { txHash: hash("77"), index: 0n },
    });
    const completeBy = vi
      .spyOn(ickbUdt, "completeBy")
      .mockResolvedValueOnce(dirtyTx)
      .mockImplementationOnce(async (txLike) => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockRejectedValueOnce(
      new ccc.ErrorTransactionInsufficientCapacity(1n, {
        isForChange: true,
      }),
    );
    vi.spyOn(ccc.Transaction.prototype, "completeFeeChangeToOutput").mockResolvedValue([
      0,
      true,
    ]);

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 7n,
    });

    expect(completed.inputs).toHaveLength(0);
    expect(completeBy).toHaveBeenCalledTimes(2);
  });

  it("rebuilds from pristine state when ordinary fee change creates output 65", async () => {
    const { sdk, ickbUdt, logicManager, lock } = testSdk();
    const tx = daoBoundaryTransaction(lock, logicManager.daoManager.script);
    setOutputType(tx, 1, logicManager.script);
    const signer = signerWithLock(lock);
    const attemptShapes: Array<[number, number]> = [];
    const completeBy = vi
      .spyOn(ickbUdt, "completeBy")
      .mockImplementation(async (txLike) => {
        await Promise.resolve();
        const attempt = ccc.Transaction.from(txLike);
        attemptShapes.push([attempt.outputs.length, attempt.inputs.length]);
        return attempt;
      });
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockImplementationOnce(
      async function (this: ccc.Transaction) {
        await Promise.resolve();
        this.addInput({ previousOutput: { txHash: hash("78"), index: 0n } });
        this.addOutput({ capacity: 1n, lock }, "0x");
        return [0, true];
      },
    );
    const completeFeeChangeToOutput = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeChangeToOutput")
      .mockResolvedValue([0, true]);

    const completed = await sdk.completeTransaction(tx, { signer, feeRate: 8n });

    expect(completed.outputs).toHaveLength(64);
    expect(completed.inputs).toHaveLength(0);
    expect(tx.outputs).toHaveLength(64);
    expect(tx.inputs).toHaveLength(0);
    expect(attemptShapes).toEqual([
      [64, 0],
      [64, 0],
    ]);
    expect(completeBy).toHaveBeenCalledTimes(2);
    expect(completeFeeChangeToOutput).toHaveBeenCalledWith(signer, 1, 8n);
  });
});

describe(`${COMPLETE_TRANSACTION_SUITE} plain-output fallback`, () => {
  it("routes output-65 fee change into the latest signer-owned plain output", async () => {
    const { sdk, ickbUdt, logicManager, lock } = testSdk();
    const tx = daoBoundaryTransaction(lock, logicManager.daoManager.script);
    const signer = signerWithLock(lock);
    mockOutput65Attempt(ickbUdt, lock);
    const completeFeeChangeToOutput = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeChangeToOutput")
      .mockResolvedValue([0, true]);

    const completed = await sdk.completeTransaction(tx, { signer, feeRate: 9n });

    expect(completed.outputs).toHaveLength(64);
    expect(completeFeeChangeToOutput).toHaveBeenCalledWith(signer, 63, 9n);
  });
});

describe(`${COMPLETE_TRANSACTION_SUITE} fallback error ownership`, () => {
  it("preserves the first DAO error when no fee-change target exists", async () => {
    const { sdk, ickbUdt, logicManager, lock } = testSdk();
    const tx = daoBoundaryTransaction(script("77"), logicManager.daoManager.script);
    const signer = signerWithLock(lock);
    mockOutput65Attempt(ickbUdt, lock);
    const completeFeeChangeToOutput = vi.spyOn(
      ccc.Transaction.prototype,
      "completeFeeChangeToOutput",
    );

    await expect(
      sdk.completeTransaction(tx, { signer, feeRate: 9n }),
    ).rejects.toMatchObject({
      name: "DaoOutputLimitError",
      message: "NervosDAO transaction has 65 output cells, exceeding the limit of 64",
    });
    expect(completeFeeChangeToOutput).not.toHaveBeenCalled();
  });

  it("propagates target fee completion errors with identity and cause intact", async () => {
    const { sdk, logicManager, lock } = testSdk();
    const tx = daoBoundaryTransaction(lock, logicManager.daoManager.script);
    setOutputType(tx, 1, logicManager.script);
    const signer = signerWithLock(lock);
    const transportCause = new Error("socket closed");
    const targetError = new TypeError("fetch failed", { cause: transportCause });
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockImplementationOnce(
      async function (this: ccc.Transaction) {
        await Promise.resolve();
        this.addOutput({ capacity: 1n, lock }, "0x");
        return [0, true];
      },
    );
    vi.spyOn(ccc.Transaction.prototype, "completeFeeChangeToOutput").mockRejectedValue(
      targetError,
    );

    await expect(sdk.completeTransaction(tx, { signer, feeRate: 10n })).rejects.toBe(
      targetError,
    );
    expect(targetError.cause).toBe(transportCause);
  });

  it("propagates pristine fallback rebuild errors", async () => {
    const { sdk, ickbUdt, logicManager, lock } = testSdk();
    const tx = daoBoundaryTransaction(lock, logicManager.daoManager.script);
    setOutputType(tx, 1, logicManager.script);
    const signer = signerWithLock(lock);
    const rebuildError = new TypeError("fetch failed");
    vi.spyOn(ickbUdt, "completeBy")
      .mockImplementationOnce(async (txLike) => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      })
      .mockRejectedValueOnce(rebuildError);
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockImplementationOnce(
      async function (this: ccc.Transaction) {
        await Promise.resolve();
        this.addOutput({ capacity: 1n, lock }, "0x");
        return [0, true];
      },
    );

    await expect(sdk.completeTransaction(tx, { signer, feeRate: 11n })).rejects.toBe(
      rebuildError,
    );
  });
});

function mockOutput65Attempt(
  ickbUdt: ReturnType<typeof testSdk>["ickbUdt"],
  lock: ccc.Script,
): void {
  vi.spyOn(ickbUdt, "completeBy").mockImplementation(async (txLike) => {
    await Promise.resolve();
    return ccc.Transaction.from(txLike);
  });
  vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockImplementationOnce(
    async function (this: ccc.Transaction) {
      await Promise.resolve();
      this.addOutput({ capacity: 1n, lock }, "0x");
      return [0, true];
    },
  );
}

function daoBoundaryTransaction(
  lock: ccc.Script,
  daoScript: ccc.Script,
): ccc.Transaction {
  const tx = transactionWithOutputs(64, lock);
  setOutputType(tx, 0, daoScript);
  return tx;
}

function setOutputType(tx: ccc.Transaction, index: number, type: ccc.Script): void {
  const output = tx.outputs[index];
  if (output === undefined) {
    throw new Error(`Expected output at index ${String(index)}`);
  }
  output.type = type;
}
