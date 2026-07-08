import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  signerWithLock,
  testSdk,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { baseClient, hash } from "../base/support/sdk_core_support.ts";
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
      client: baseClient,
      feeRate: 7n,
    });

    expect(completed.inputs).toHaveLength(0);
    expect(completeBy).toHaveBeenCalledTimes(2);
  });
});
