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
  it("uses the latest matching output for the selected fee change target kind", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const tx = ccc.Transaction.default();
    tx.addOutput({ lock, type: logicManager.script }, "0x");
    tx.addOutput({ lock, type: orderManager.script }, "0x");
    tx.addOutput({ lock, type: logicManager.script }, "0x");
    const signer = signerWithLock(lock);
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockRejectedValueOnce(
      new ccc.ErrorTransactionInsufficientCapacity(1n, {
        isForChange: true,
      }),
    );
    const completeFeeChangeToOutput = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeChangeToOutput")
      .mockResolvedValue([0, true]);

    await sdk.completeTransaction(tx, {
      signer,
      client: baseClient,
      feeRate: 8n,
    });

    expect(completeFeeChangeToOutput).toHaveBeenCalledWith(signer, 2, 8n);
  });

  it("routes fee change into signer-owned order master when no receipt exists", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const tx = ccc.Transaction.default();
    tx.addOutput({ lock: script("77"), type: logicManager.script }, "0x");
    tx.addOutput({ lock, type: orderManager.script }, "0x");
    const signer = signerWithLock(lock);
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockRejectedValueOnce(
      new ccc.ErrorTransactionInsufficientCapacity(1n, {
        isForChange: true,
      }),
    );
    const completeFeeChangeToOutput = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeChangeToOutput")
      .mockResolvedValue([0, true]);

    await sdk.completeTransaction(tx, {
      signer,
      client: baseClient,
      feeRate: 9n,
    });

    expect(completeFeeChangeToOutput).toHaveBeenCalledWith(signer, 1, 9n);
  });

  it("routes fee change into signer-owned withdrawal owner when no receipt or master exists", async () => {
    const { sdk, logicManager, ownedOwnerManager, lock } = testSdk();
    const tx = ccc.Transaction.default();
    tx.addOutput({ lock: script("77"), type: logicManager.script }, "0x");
    tx.addOutput({ lock, type: ownedOwnerManager.script }, "0x");
    const signer = signerWithLock(lock);
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockRejectedValueOnce(
      new ccc.ErrorTransactionInsufficientCapacity(1n, {
        isForChange: true,
      }),
    );
    const completeFeeChangeToOutput = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeChangeToOutput")
      .mockResolvedValue([0, true]);

    await sdk.completeTransaction(tx, {
      signer,
      client: baseClient,
      feeRate: 11n,
    });

    expect(completeFeeChangeToOutput).toHaveBeenCalledWith(signer, 1, 11n);
  });
});
