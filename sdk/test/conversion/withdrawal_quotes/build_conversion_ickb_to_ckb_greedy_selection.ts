import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ratio } from "../../../src/order/ratio.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { state } from "../../transaction/base/support/sdk_core_support.ts";
import {
  expectIckbToCkbDirectPlusOrder,
  mintedOrders,
  outPointsOf,
  spentOutPoints,
  stubSigner,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { projectionReadyDeposit } from "./support/sdk_cell_support.ts";

// The built transaction as is: these tests read what the builders put in.
vi.mock(import("../../../src/complete.ts"), async (importOriginal) =>
  (
    await import("../deposits_and_limits/support/passthrough_completion.ts")
  ).passthroughCompletion(await importOriginal()),
);

afterEach(() => {
  vi.restoreAllMocks();
});

const ICKB_TO_CKB = "ickb-to-ckb";

const DIRECT_PLUS_ORDER = "direct-plus-order";

describe("IckbSdk.buildConversionTransaction", () => {
  it("takes the earliest-maturing ready deposit before a later one with more surplus", async () => {
    const { sdk } = testSdk();
    const unit = ICKB_DEPOSIT_CAP / 10n;
    const earlier = projectionReadyDeposit(8n * unit, 30n * 60n * 1000n, {
      ckbValue: 8n * unit,
      id: "b1",
    });
    const laterHigherGain = projectionReadyDeposit(8n * unit, 2n * 60n * 60n * 1000n, {
      ckbValue: 8n * unit + 1000n,
      id: "b2",
    });
    const withdrawn = [earlier];

    const result = await sdk.buildConversionTransaction({
      direction: ICKB_TO_CKB,
      amount: ICKB_DEPOSIT_CAP,
      signer: stubSigner,
      state: state({
        exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
        poolDeposits: [laterHigherGain, earlier],
        ckbAvailable: 0n,
        ickbAvailable: ICKB_DEPOSIT_CAP,
        // What is already converting, a day out, does not date this conversion.
        estimatedMaturity: 24n * 60n * 60n * 1000n,
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      conversionKind: DIRECT_PLUS_ORDER,
      // The claim, half an hour out, is later than the remainder order's one bot turn.
      estimatedMaturity: 30n * 60n * 1000n,
      // The claim, one epoch past the tip, less the wallet's reserve of three eighths.
      broadcastBefore: {
        epoch: ccc.Epoch.from([1n, 5n, 8n]),
        tipMaxAgeMs: 30 * 60 * 1000,
      },
    });
    if (!result.ok) {
      throw new Error("Expected a conversion");
    }
    expect(spentOutPoints(result.tx)).toEqual(outPointsOf(withdrawn));
    expect(mintedOrders(result.tx)).toHaveLength(1);
  });

  it("walks the greedy selection, so two small deposits beat one large anchor", async () => {
    const { sdk } = testSdk();
    const unit = ICKB_DEPOSIT_CAP / 10n;
    const large = projectionReadyDeposit(8n * unit, 0n, { id: "c1" });
    const smallFirst = projectionReadyDeposit(4n * unit, 0n, { id: "c2" });
    const smallSecond = projectionReadyDeposit(4n * unit, 0n, { id: "c3" });
    const withdrawn = [smallFirst, smallSecond];
    const order = { ckbValue: 0n, udtValue: 2n * unit };

    await expectIckbToCkbDirectPlusOrder({
      sdk,
      order,
      withdrawn,
      deposits: [smallFirst, smallSecond, large],
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    });
  });
});
