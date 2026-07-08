import { ccc } from "@ckb-ccc/core";
import { DaoOutputLimitError } from "@ickb/dao";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  signerWithLock,
  testSdk,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { baseClient, transactionWithOutputs } from "../base/support/sdk_core_support.ts";
import { COMPLETE_TRANSACTION_SUITE } from "./support/sdk_suite_titles.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(COMPLETE_TRANSACTION_SUITE, () => {
  it("runs UDT and fee before DAO-limit rejection", async () => {
    const calls: string[] = [];
    const { sdk, ickbUdt, lock } = testSdk();
    const signer = signerWithLock(lock);
    const tx = transactionWithOutputs(65, lock);
    vi.spyOn(ickbUdt, "completeBy").mockImplementation(async (txLike) => {
      calls.push("udt");
      await Promise.resolve();
      return ccc.Transaction.from(txLike);
    });
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockImplementation(async () => {
      calls.push("fee");
      await Promise.resolve();
      throw new DaoOutputLimitError(65);
    });
    await expect(
      sdk.completeTransaction(tx, {
        signer,
        client: baseClient,
        feeRate: 42n,
      }),
    ).rejects.toThrow(DaoOutputLimitError);

    expect(calls).toEqual(["udt", "fee"]);
  });

  it("uses the provided fee rate", async () => {
    const { sdk, lock } = testSdk();
    const signer = signerWithLock(lock);
    const completeFeeBy = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeBy")
      .mockResolvedValue([0, false]);

    await sdk.completeTransaction(ccc.Transaction.default(), {
      signer,
      client: baseClient,
      feeRate: 123n,
    });

    expect(completeFeeBy).toHaveBeenCalledWith(signer, 123n);
  });

  it("routes fee change into the signer-owned receipt before other protocol outputs", async () => {
    const { sdk, logicManager, ownedOwnerManager, orderManager, lock } = testSdk();
    const tx = ccc.Transaction.default();
    tx.addOutput({ lock, type: orderManager.script }, "0x");
    tx.addOutput({ lock, type: logicManager.script }, "0x");
    tx.addOutput({ lock, type: ownedOwnerManager.script }, "0x");
    const signer = signerWithLock(lock);
    const changeError = new ccc.ErrorTransactionInsufficientCapacity(1n, {
      isForChange: true,
    });
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockRejectedValueOnce(
      changeError,
    );
    const completeFeeChangeToOutput = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeChangeToOutput")
      .mockResolvedValue([0, true]);

    await sdk.completeTransaction(tx, {
      signer,
      client: baseClient,
      feeRate: 7n,
    });

    expect(completeFeeChangeToOutput).toHaveBeenCalledWith(signer, 1, 7n);
  });
});
