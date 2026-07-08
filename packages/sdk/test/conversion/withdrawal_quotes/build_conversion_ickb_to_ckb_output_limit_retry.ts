import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP } from "@ickb/core";
import { DaoOutputLimitError } from "@ickb/dao";
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

const DIRECT_PLUS_ORDER = "direct-plus-order";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("retries iCKB-to-CKB withdrawals after DAO output-limit failures", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const first = projectionReadyDeposit(ICKB_DEPOSIT_CAP / 2n, 0n);
    const second = projectionReadyDeposit(ICKB_DEPOSIT_CAP / 2n, 15n * 60n * 1000n);
    const ringAnchor = projectionReadyDeposit(ICKB_DEPOSIT_CAP, 1n);
    const requestedCounts: number[] = [];
    const requestWithdrawal = vi
      .spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(async (txLike, deposits) => {
        await Promise.resolve();
        requestedCounts.push(deposits.length);
        if (requestedCounts.length === 1) {
          throw new DaoOutputLimitError(65);
        }
        expect(deposits).toHaveLength(1);
        return ccc.Transaction.from(txLike);
      });
    vi.spyOn(orderManager, "mint").mockImplementation((txLike) =>
      ccc.Transaction.from(txLike),
    );

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
        direction: ICKB_TO_CKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: conversionContext({
          system: {
            poolDeposits: {
              deposits: [first, second, ringAnchor],
              readyDeposits: [first, second, ringAnchor],
              id: "pool",
            },
          },
          ckbAvailable: 0n,
          ickbAvailable: ICKB_DEPOSIT_CAP,
        }),
      }),
    ).resolves.toMatchObject({
      ok: true,
      conversion: { kind: DIRECT_PLUS_ORDER },
    });

    expect(requestWithdrawal).toHaveBeenCalledTimes(2);
    expect(requestedCounts).toEqual([2, 1]);
  });
});
