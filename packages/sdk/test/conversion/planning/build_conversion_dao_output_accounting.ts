import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ICKB_DEPOSIT_CAP } from "../../../src/core/index.ts";
import {
  hash,
  system,
  transactionWithOutputs,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import {
  placeholderReceipt,
  placeholderWithdrawal,
} from "../withdrawal_quotes/support/sdk_cell_support.ts";
import { placeholderOrder } from "./support/sdk_order_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const CKB_TO_ICKB = "ckb-to-ickb";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("does not count input-only base activities as planned DAO outputs", async () => {
    const { sdk, logicManager, ownedOwnerManager, orderManager, lock } = testSdk();
    vi.spyOn(orderManager, "melt").mockImplementation((txLike) => {
      const tx = ccc.Transaction.from(txLike);
      tx.inputs.push(
        ccc.CellInput.from({
          previousOutput: { txHash: hash("c1"), index: 0n },
        }),
      );
      return tx;
    });
    vi.spyOn(logicManager, "completeDeposit").mockImplementation((txLike) => {
      const tx = ccc.Transaction.from(txLike);
      tx.inputs.push(
        ccc.CellInput.from({
          previousOutput: { txHash: hash("c2"), index: 0n },
        }),
      );
      return tx;
    });
    vi.spyOn(ownedOwnerManager, "withdraw").mockImplementation((txLike) => {
      const tx = ccc.Transaction.from(txLike);
      tx.inputs.push(
        ccc.CellInput.from({
          previousOutput: { txHash: hash("c3"), index: 0n },
        }),
      );
      return tx;
    });
    const deposit = vi.spyOn(logicManager, "deposit").mockImplementation((txLike) => {
      return ccc.Transaction.from(txLike);
    });
    const mint = vi
      .spyOn(orderManager, "mint")
      .mockImplementation((txLike) => ccc.Transaction.from(txLike));

    await expect(
      sdk.buildConversionTransaction(transactionWithOutputs(60, lock), {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: {
          system: system({ ckbAvailable: ICKB_DEPOSIT_CAP }),
          receipts: [placeholderReceipt],
          readyWithdrawals: [placeholderWithdrawal],
          availableOrders: [placeholderOrder],
          ckbAvailable: ICKB_DEPOSIT_CAP,
          ickbAvailable: 0n,
          estimatedMaturity: 0n,
        },
      }),
    ).resolves.toMatchObject({ ok: true, conversion: { kind: "direct" } });

    expect(deposit).toHaveBeenCalledTimes(1);
    expect(mint).not.toHaveBeenCalled();
  });
});
