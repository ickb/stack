import { ccc } from "@ckb-ccc/core";
import { Ratio } from "@ickb/order";
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

const ICKB_TO_CKB = "ickb-to-ckb";

const AMOUNT_TOO_SMALL = "amount-too-small";

const CKB_TO_ICKB = "ckb-to-ickb";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("returns a typed failure when default iCKB-to-CKB fee precision exceeds Uint64", async () => {
    const { sdk, lock } = testSdk();

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
        direction: ICKB_TO_CKB,
        amount: 1n,
        lock,
        context: conversionContext({
          system: {
            exchangeRatio: Ratio.from({
              ckbScale: (1n << 64n) - 1n,
              udtScale: (1n << 64n) - 2n,
            }),
            ckbAvailable: 1n,
            poolDeposits: {
              deposits: [],
              readyDeposits: [],
              id: "pool",
            },
          },
          ckbAvailable: 0n,
          ickbAvailable: 1n,
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: AMOUNT_TOO_SMALL,
      estimatedMaturity: 0n,
    });
  });

  it("returns a typed failure when default CKB-to-iCKB fee precision exceeds Uint64", async () => {
    const { sdk, lock } = testSdk();

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
        direction: CKB_TO_ICKB,
        amount: 1n,
        lock,
        context: conversionContext({
          system: {
            exchangeRatio: Ratio.from({
              ckbScale: (1n << 64n) - 1n,
              udtScale: (1n << 64n) - 2n,
            }),
            ckbAvailable: 0n,
          },
          ckbAvailable: 1n,
          ickbAvailable: 0n,
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: AMOUNT_TOO_SMALL,
      estimatedMaturity: 0n,
    });
  });
});
