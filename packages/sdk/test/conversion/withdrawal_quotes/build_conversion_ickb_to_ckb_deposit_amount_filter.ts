import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP } from "@ickb/core";
import { Ratio } from "@ickb/order";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseClient,
  conversionContext,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { projectionReadyDeposit } from "./support/sdk_cell_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const ICKB_TO_CKB = "ickb-to-ckb";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("skips iCKB-to-CKB deposits above the requested amount even with high surplus", async () => {
    const { sdk, ownedOwnerManager, lock } = testSdk();
    const oversized = projectionReadyDeposit(ICKB_DEPOSIT_CAP + 1n, 0n, {
      ckbValue: ICKB_DEPOSIT_CAP * 2n,
      id: "c1",
    });
    const fitting = projectionReadyDeposit(ICKB_DEPOSIT_CAP, 15n * 60n * 1000n, {
      ckbValue: ICKB_DEPOSIT_CAP,
      id: "c2",
    });
    const requestWithdrawal = vi
      .spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(async (txLike, deposits) => {
        await Promise.resolve();
        expect(deposits).toEqual([fitting]);
        return ccc.Transaction.from(txLike);
      });

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
        direction: ICKB_TO_CKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: conversionContext({
          system: {
            exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
            poolDeposits: {
              deposits: [oversized, fitting],
              readyDeposits: [oversized, fitting],
              id: "pool",
            },
          },
          ckbAvailable: 0n,
          ickbAvailable: ICKB_DEPOSIT_CAP,
        }),
      }),
    ).resolves.toMatchObject({ ok: true, conversion: { kind: "direct" } });

    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
  });
});
