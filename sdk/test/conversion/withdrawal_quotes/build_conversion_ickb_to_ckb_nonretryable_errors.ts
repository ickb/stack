import { afterEach, describe, expect, it, vi } from "vitest";
import { Ratio } from "../../../src/order/ratio.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import {
  stubSigner,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { projectionReadyDeposit } from "./support/sdk_cell_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const WITHDRAWAL_FAILED = "withdrawal failed";

const ICKB_TO_CKB = "ickb-to-ckb";

describe("IckbSdk.buildConversionTransaction", () => {
  it("fails fast on non-retryable iCKB-to-CKB construction errors", async () => {
    const { sdk, ownedOwnerManager, lock } = testSdk();
    const extra = projectionReadyDeposit(1n, 0n);
    const protectedAnchor = projectionReadyDeposit(2n, 1n);
    vi.spyOn(ownedOwnerManager, "requestWithdrawal").mockImplementation(() => {
      throw new Error(WITHDRAWAL_FAILED);
    });

    await expect(
      sdk.buildConversionTransaction({
        direction: ICKB_TO_CKB,
        amount: 1n,
        lock,
        signer: stubSigner,
        context: conversionContext({
          system: {
            exchangeRatio: Ratio.from({ ckbScale: 100n, udtScale: 1n }),
            poolDeposits: [extra, protectedAnchor],
          },
          ckbAvailable: 0n,
          ickbAvailable: 1n,
        }),
      }),
    ).rejects.toThrow(WITHDRAWAL_FAILED);
  });
});
