import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  signerWithLock,
  testSdk,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { baseClient } from "../base/support/sdk_core_support.ts";
import { COMPLETE_TRANSACTION_SUITE } from "./support/sdk_suite_titles.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(COMPLETE_TRANSACTION_SUITE, () => {
  it("rethrows change-cell capacity errors when no safe output exists", async () => {
    const { sdk, logicManager, lock } = testSdk();
    const tx = ccc.Transaction.default();
    tx.addOutput({ lock: script("77"), type: logicManager.script }, "0x");
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

    await expect(
      sdk.completeTransaction(tx, {
        signer,
        client: baseClient,
        feeRate: 9n,
      }),
    ).rejects.toBe(changeError);

    expect(completeFeeChangeToOutput).not.toHaveBeenCalled();
  });

  it("does not retry non-change fee errors", async () => {
    const { sdk, logicManager, lock } = testSdk();
    const tx = ccc.Transaction.default();
    tx.addOutput({ lock, type: logicManager.script }, "0x");
    const signer = signerWithLock(lock);
    const feeError = new ccc.ErrorTransactionInsufficientCapacity(1n);
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockRejectedValueOnce(feeError);
    const completeFeeChangeToOutput = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeChangeToOutput")
      .mockResolvedValue([0, true]);

    await expect(
      sdk.completeTransaction(tx, {
        signer,
        client: baseClient,
        feeRate: 10n,
      }),
    ).rejects.toBe(feeError);

    expect(completeFeeChangeToOutput).not.toHaveBeenCalled();
  });
});
