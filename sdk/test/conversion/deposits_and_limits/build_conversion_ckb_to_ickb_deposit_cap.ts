import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  stubSigner,
  testSdk,
} from "./support/sdk_fixture_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const maxDirectDeposits = 63;

const CKB_TO_ICKB = "ckb-to-ickb";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("starts CKB-to-iCKB planning at the DAO output limit", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const deposit = vi
      .spyOn(logicManager, "deposit")
      .mockImplementation((txLike, quantity) => {
        expect(quantity).toBe(maxDirectDeposits);
        return ccc.Transaction.from(txLike);
      });
    vi.spyOn(orderManager, "mint").mockImplementation((txLike) =>
      ccc.Transaction.from(txLike),
    );

    await sdk.buildConversionTransaction(ccc.Transaction.default(), {
      direction: CKB_TO_ICKB,
      amount: ICKB_DEPOSIT_CAP * BigInt(maxDirectDeposits + 1),
      lock,
      signer: stubSigner,
      context: conversionContext({
        system: { ckbAvailable: ICKB_DEPOSIT_CAP },
        ckbAvailable: ICKB_DEPOSIT_CAP * BigInt(maxDirectDeposits + 1),
        ickbAvailable: 0n,
      }),
    });

    expect(deposit).toHaveBeenCalledTimes(1);
  });
});
