import { afterEach, describe, expect, it, vi } from "vitest";
import { Ratio } from "../../../src/order/ratio.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import {
  outPointsOf,
  spentOutPoints,
  stubSigner,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { projectionReadyDeposit } from "./support/sdk_cell_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const ICKB_TO_CKB = "ickb-to-ckb";

describe("IckbSdk.buildConversionTransaction", () => {
  it("skips iCKB-to-CKB deposits above the requested amount even with high surplus", async () => {
    const { sdk } = testSdk();
    const oversized = projectionReadyDeposit(ICKB_DEPOSIT_CAP + 1n, 0n, {
      ckbValue: ICKB_DEPOSIT_CAP * 2n,
      id: "c1",
    });
    const fitting = projectionReadyDeposit(ICKB_DEPOSIT_CAP, 15n * 60n * 1000n, {
      ckbValue: ICKB_DEPOSIT_CAP,
      id: "c2",
    });

    const result = await sdk.buildConversionTransaction({
      direction: ICKB_TO_CKB,
      amount: ICKB_DEPOSIT_CAP,
      signer: stubSigner,
      context: conversionContext({
        system: {
          exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
          poolDeposits: [oversized, fitting],
        },
        ckbAvailable: 0n,
        ickbAvailable: ICKB_DEPOSIT_CAP,
      }),
    });

    expect(result).toMatchObject({ ok: true, conversionKind: "direct" });
    expect(result).not.toHaveProperty("orderOccupiedCapacity");
    if (!result.ok) {
      throw new Error("Expected a conversion");
    }
    expect(spentOutPoints(result.tx)).toEqual(outPointsOf([fitting]));
  });
});
