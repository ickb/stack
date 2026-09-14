import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ratio } from "../../../src/order/index.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  stubSigner,
  testSdk,
} from "./support/sdk_fixture_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const ICKB_TO_CKB = "ickb-to-ckb";

const AMOUNT_TOO_SMALL = "amount-too-small";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("returns a typed failure when bounded iCKB-to-CKB fee precision collapses", async () => {
    const { sdk, lock } = testSdk();

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), {
        direction: ICKB_TO_CKB,
        amount: 1n,
        lock,
        signer: stubSigner,
        context: conversionContext({
          system: {
            exchangeRatio: Ratio.from({
              ckbScale: (1n << 64n) - 1n,
              udtScale: 1n,
            }),
            ckbAvailable: 1n,
            poolDeposits: {
              deposits: [],
              id: "pool",
            },
          },
          ckbAvailable: 0n,
          ickbAvailable: 1n,
        }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: AMOUNT_TOO_SMALL,
      estimatedMaturity: 0n,
    });
  });
});
