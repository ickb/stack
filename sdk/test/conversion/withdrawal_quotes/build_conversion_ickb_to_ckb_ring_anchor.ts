import { afterEach, describe, it, vi } from "vitest";
import { Ratio } from "../../../src/order/ratio.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import {
  expectIckbToCkbDirectPlusOrder,
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

describe("IckbSdk.buildConversionTransaction", () => {
  it("leaves the segment anchor and withdraws the surplus deposit", async () => {
    const { sdk } = testSdk();
    const unit = ICKB_DEPOSIT_CAP / 10n;
    const largerLowerGain = projectionReadyDeposit(9n * unit, 0n, {
      ckbValue: 9n * unit,
      id: "a1",
    });
    const smallerHigherGain = projectionReadyDeposit(8n * unit, 30n * 60n * 1000n, {
      ckbValue: 8n * unit + 1000n,
      id: "a2",
    });
    const withdrawn = [smallerHigherGain];
    const order = { ckbValue: 0n, udtValue: 2n * unit };

    await expectIckbToCkbDirectPlusOrder({
      sdk,
      order,
      withdrawn,
      deposits: [largerLowerGain, smallerHigherGain],
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    });
  });

  it("leaves the largest deposit as the anchor and takes the two earlier surplus ones", async () => {
    const { sdk } = testSdk();
    const unit = ICKB_DEPOSIT_CAP / 10n;
    const smallEarlier = projectionReadyDeposit(4n * unit, 0n);
    const smallLater = projectionReadyDeposit(4n * unit, 15n * 60n * 1000n);
    const largeMuchLater = projectionReadyDeposit(9n * unit, 2n * 60n * 60n * 1000n);
    const withdrawn = [smallEarlier, smallLater];
    const order = { ckbValue: 0n, udtValue: 2n * unit };

    await expectIckbToCkbDirectPlusOrder({
      sdk,
      order,
      withdrawn,
      deposits: [smallEarlier, smallLater, largeMuchLater],
      exchangeRatio: Ratio.from({ ckbScale: 100n, udtScale: 1n }),
    });
  });
});
