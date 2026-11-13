import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConversionTransaction } from "../../../src/build.ts";
import { Ratio } from "../../../src/order/ratio.ts";
import { state } from "../../transaction/base/support/sdk_core_support.ts";
import { stubSigner } from "./support/sdk_fixture_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const ICKB_TO_CKB = "ickb-to-ckb";

const AMOUNT_TOO_SMALL = "amount-too-small";

describe("buildConversionTransaction", () => {
  it("returns a typed failure when bounded iCKB-to-CKB fee precision collapses", async () => {
    await expect(
      buildConversionTransaction(
        stubSigner,
        state({
          exchangeRatio: Ratio.from({
            ckbScale: (1n << 64n) - 1n,
            udtScale: 1n,
          }),
          poolDeposits: [],
          ckbAvailable: 0n,
          ickbAvailable: 1n,
        }),
        ICKB_TO_CKB,
        1n,
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: AMOUNT_TOO_SMALL,
    });
  });
});
