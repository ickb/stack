import { ccc } from "@ckb-ccc/core";
import { Ratio } from "@ickb/order";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseClient,
  conversionContext,
  hash,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { projectionReadyDeposit } from "./support/sdk_cell_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const WITHDRAWAL_FAILED = "withdrawal failed";

const ICKB_TO_CKB = "ickb-to-ckb";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("fails fast on non-retryable iCKB-to-CKB construction errors", async () => {
    const { sdk, ownedOwnerManager, lock } = testSdk();
    const extra = projectionReadyDeposit(1n, 0n);
    const protectedAnchor = projectionReadyDeposit(2n, 1n);
    vi.spyOn(ownedOwnerManager, "requestWithdrawal").mockRejectedValue(
      new Error(WITHDRAWAL_FAILED),
    );

    const tx = ccc.Transaction.default();
    tx.inputs.push(
      ccc.CellInput.from({
        previousOutput: { txHash: hash("90"), index: 0n },
      }),
    );
    tx.outputs.push(ccc.CellOutput.from({ capacity: 1n, lock }));
    tx.outputsData.push("0x");

    await expect(
      sdk.buildConversionTransaction(tx, baseClient, {
        direction: ICKB_TO_CKB,
        amount: 1n,
        lock,
        context: conversionContext({
          system: {
            exchangeRatio: Ratio.from({ ckbScale: 100n, udtScale: 1n }),
            poolDeposits: {
              deposits: [extra, protectedAnchor],
              readyDeposits: [extra, protectedAnchor],
              id: "pool",
            },
          },
          ckbAvailable: 0n,
          ickbAvailable: 1n,
        }),
      }),
    ).rejects.toThrow(WITHDRAWAL_FAILED);
  });
});
