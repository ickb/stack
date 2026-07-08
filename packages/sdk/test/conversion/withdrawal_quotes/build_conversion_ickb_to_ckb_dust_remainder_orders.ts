import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP, convert } from "@ickb/core";
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

const DIRECT_PLUS_ORDER = "direct-plus-order";

const DUST_ICKB_TO_CKB = "dust-ickb-to-ckb";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("builds iCKB-to-CKB direct withdrawals plus dust remainder orders", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const directDeposit = projectionReadyDeposit(ICKB_DEPOSIT_CAP);
    const ringAnchor = projectionReadyDeposit(ICKB_DEPOSIT_CAP + 1n, 1n);
    const requestWithdrawal = vi
      .spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(
        async (
          ...[txLike, deposits, , , requestOptions]: [
            txLike: ccc.TransactionLike,
            deposits: unknown,
            lock: unknown,
            client: unknown,
            requestOptions: unknown,
          ]
        ) => {
          await Promise.resolve();
          expect(deposits).toEqual([directDeposit]);
          expect(requestOptions).toEqual({
            requiredLiveDeposits: [ringAnchor],
          });
          return ccc.Transaction.from(txLike);
        },
      );
    const mint = vi
      .spyOn(orderManager, "mint")
      .mockImplementation((txLike, _lock, info, amounts) => {
        expect(info.ckbMinMatchLog).toBe(33);
        expect(amounts).toEqual({ ckbValue: 0n, udtValue: 100000n });
        return ccc.Transaction.from(txLike);
      });
    const exchangeRatio = Ratio.from({
      ckbScale: 10000000000000000n,
      udtScale: 10008200000000000n,
    });
    const amount = ICKB_DEPOSIT_CAP + 100000n;

    const result = await sdk.buildConversionTransaction(
      ccc.Transaction.default(),
      baseClient,
      {
        direction: ICKB_TO_CKB,
        amount,
        lock,
        context: conversionContext({
          system: {
            exchangeRatio,
            ckbAvailable: convert(false, ICKB_DEPOSIT_CAP, exchangeRatio),
            poolDeposits: {
              deposits: [directDeposit, ringAnchor],
              readyDeposits: [directDeposit, ringAnchor],
              id: "pool",
            },
          },
          ckbAvailable: 0n,
          ickbAvailable: amount,
        }),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      conversion: { kind: DIRECT_PLUS_ORDER },
      conversionNotice: {
        kind: DUST_ICKB_TO_CKB,
        inputIckb: 100000n,
        outputCkb: 100072n,
        incentiveCkb: 10n,
        maturityEstimateUnavailable: false,
      },
    });
    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
  });
});
