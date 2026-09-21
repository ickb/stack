import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ratio } from "../../../src/order/ratio.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  stubSigner,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { projectionReadyDeposit } from "./support/sdk_cell_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const ICKB_TO_CKB = "ickb-to-ckb";

const DIRECT_PLUS_ORDER = "direct-plus-order";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("keeps direct withdrawals when an iCKB-to-CKB dust remainder needs quote-preserving Uint64 encoding", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const directDeposit = projectionReadyDeposit(ICKB_DEPOSIT_CAP - 1000000n);
    const ringAnchor = projectionReadyDeposit(ICKB_DEPOSIT_CAP, 1n);
    const requestWithdrawal = vi
      .spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation((txLike) => ccc.Transaction.from(txLike));
    const mint = vi
      .spyOn(orderManager, "mint")
      .mockImplementation((txLike, _lock, _info, amounts) => {
        expect(amounts).toEqual({ ckbValue: 0n, udtValue: 1000000n });
        return ccc.Transaction.from(txLike);
      });
    const exchangeRatio = Ratio.from({
      ckbScale: 10000000000000000n,
      udtScale: 11850413696044750n,
    });
    const amount = ICKB_DEPOSIT_CAP;

    const result = await sdk.buildConversionTransaction(ccc.Transaction.default(), {
      direction: ICKB_TO_CKB,
      amount,
      lock,
      signer: stubSigner,
      context: conversionContext({
        system: {
          exchangeRatio,
          feeRate: 33222n,
          poolDeposits: [directDeposit, ringAnchor],
        },
        ckbAvailable: 0n,
        ickbAvailable: amount,
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      conversion: { kind: DIRECT_PLUS_ORDER },
      conversionNotice: { inputIckb: 1000000n },
    });
    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
  });
});
