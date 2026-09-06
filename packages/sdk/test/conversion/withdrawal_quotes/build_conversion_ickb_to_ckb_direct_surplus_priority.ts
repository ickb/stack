import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ICKB_DEPOSIT_CAP } from "../../../src/core/index.ts";
import { Ratio } from "../../../src/order/index.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  expectIckbToCkbDirectPlusOrder,
  mockWithdrawalWithRemainderOrder,
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
  it("preserves iCKB-to-CKB maturity-bucket priority before direct surplus", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const unit = ICKB_DEPOSIT_CAP / 10n;
    const earlier = projectionReadyDeposit(8n * unit, 30n * 60n * 1000n, {
      ckbValue: 8n * unit,
      id: "b1",
    });
    const laterHigherGain = projectionReadyDeposit(8n * unit, 2n * 60n * 60n * 1000n, {
      ckbValue: 8n * unit + 1000n,
      id: "b2",
    });
    const requestWithdrawal = vi
      .spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation((txLike, deposits) => {
        expect(deposits).toEqual([earlier]);
        return ccc.Transaction.from(txLike);
      });
    const mint = vi
      .spyOn(orderManager, "mint")
      .mockImplementation((txLike) => ccc.Transaction.from(txLike));

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), {
        direction: ICKB_TO_CKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        signer: stubSigner,
        context: conversionContext({
          system: {
            exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
            ckbAvailable: 10n,
            poolDeposits: {
              deposits: [laterHigherGain, earlier],
              id: "pool",
            },
          },
          ckbAvailable: 0n,
          ickbAvailable: ICKB_DEPOSIT_CAP,
        }),
      }),
    ).resolves.toMatchObject({
      ok: true,
      conversion: { kind: DIRECT_PLUS_ORDER },
    });

    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("prefers more direct deposits when value and surplus tie", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const unit = ICKB_DEPOSIT_CAP / 10n;
    const large = projectionReadyDeposit(8n * unit, 0n, { id: "c1" });
    const smallFirst = projectionReadyDeposit(4n * unit, 0n, { id: "c2" });
    const smallSecond = projectionReadyDeposit(4n * unit, 0n, { id: "c3" });
    const { mint, requestWithdrawal } = mockWithdrawalWithRemainderOrder(
      { ownedOwnerManager, orderManager },
      [smallFirst, smallSecond],
      { ckbValue: 0n, udtValue: 2n * unit },
    );

    await expectIckbToCkbDirectPlusOrder({
      sdk,
      lock,
      deposits: [smallFirst, smallSecond, large],
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    });

    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
  });
});
