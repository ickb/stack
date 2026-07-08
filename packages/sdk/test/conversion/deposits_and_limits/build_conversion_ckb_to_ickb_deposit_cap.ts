import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP } from "@ickb/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseClient,
  conversionContext,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  testSdk,
} from "./support/sdk_fixture_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const maxDirectDeposits = 60;

const CKB_TO_ICKB = "ckb-to-ickb";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("caps CKB-to-iCKB direct deposits", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const deposit = vi
      .spyOn(logicManager, "deposit")
      .mockImplementation(async (txLike, quantity) => {
        await Promise.resolve();
        expect(quantity).toBe(maxDirectDeposits);
        return ccc.Transaction.from(txLike);
      });
    vi.spyOn(orderManager, "mint").mockImplementation((txLike) =>
      ccc.Transaction.from(txLike),
    );

    await sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
      direction: CKB_TO_ICKB,
      amount: ICKB_DEPOSIT_CAP * BigInt(maxDirectDeposits + 1),
      lock,
      context: conversionContext({
        system: { ckbAvailable: ICKB_DEPOSIT_CAP },
        ckbAvailable: ICKB_DEPOSIT_CAP * BigInt(maxDirectDeposits + 1),
        ickbAvailable: 0n,
      }),
    });

    expect(deposit).toHaveBeenCalledTimes(1);
  });
});
