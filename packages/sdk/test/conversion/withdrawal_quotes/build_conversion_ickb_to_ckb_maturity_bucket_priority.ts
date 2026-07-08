import { ICKB_DEPOSIT_CAP } from "@ickb/core";
import { Ratio } from "@ickb/order";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  expectIckbToCkbDirectPlusOrder,
  mockWithdrawalWithRemainderOrder,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { projectionReadyDeposit } from "./support/sdk_cell_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("prefers better direct iCKB-to-CKB economic surplus within a maturity bucket", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const unit = ICKB_DEPOSIT_CAP / 10n;
    const largerLowerGain = projectionReadyDeposit(9n * unit, 0n, {
      ckbValue: 9n * unit,
      id: "a1",
    });
    const smallerHigherGain = projectionReadyDeposit(8n * unit, 30n * 60n * 1000n, {
      ckbValue: 8n * unit + 1000n,
      id: "a2",
    });
    const { mint, requestWithdrawal } = mockWithdrawalWithRemainderOrder(
      { ownedOwnerManager, orderManager },
      [smallerHigherGain],
      { ckbValue: 0n, udtValue: 2n * unit },
    );

    await expectIckbToCkbDirectPlusOrder({
      sdk,
      lock,
      deposits: [largerLowerGain, smallerHigherGain],
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    });

    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("prefers an earlier iCKB-to-CKB maturity bucket over a marginally larger withdrawal", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const unit = ICKB_DEPOSIT_CAP / 10n;
    const smallEarlier = projectionReadyDeposit(4n * unit, 0n);
    const smallLater = projectionReadyDeposit(4n * unit, 15n * 60n * 1000n);
    const largeMuchLater = projectionReadyDeposit(9n * unit, 2n * 60n * 60n * 1000n);
    const { mint, requestWithdrawal } = mockWithdrawalWithRemainderOrder(
      { ownedOwnerManager, orderManager },
      [smallEarlier, smallLater],
      { ckbValue: 0n, udtValue: 2n * unit },
    );

    await expectIckbToCkbDirectPlusOrder({
      sdk,
      lock,
      deposits: [smallEarlier, smallLater, largeMuchLater],
      exchangeRatio: Ratio.from({ ckbScale: 100n, udtScale: 1n }),
    });

    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
  });
});
