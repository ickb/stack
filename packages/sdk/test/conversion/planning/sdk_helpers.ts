import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import {
  baseTransactionOptions,
  conversionKind,
  plannedDaoOutputLimitError,
} from "../../../src/conversion/sdk_conversion_common.ts";
import { DaoOutputLimitError } from "../../../src/dao/index.ts";
import { Info } from "../../../src/order/index.ts";
import {
  conversionContext,
  ratio,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  signerWithLock,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { projectionReadyDeposit } from "../withdrawal_quotes/support/sdk_cell_support.ts";
import { projectionOrderGroup } from "./support/sdk_order_support.ts";

describe("sdk helper coverage", () => {
  it("covers conversion option helper branches", () => {
    const context = conversionContext({
      availableOrders: [
        projectionOrderGroup({
          ckbValue: 1n,
          udtValue: 2n,
          isDualRatio: true,
          isMatchable: true,
        }),
      ],
      receipts: [],
      readyWithdrawals: [],
    });
    const lock = script("11");
    const deposits = [projectionReadyDeposit(5n, 0n, { id: "01" })];

    expect(baseTransactionOptions(context)).toEqual({
      orders: context.availableOrders,
      receipts: [],
      readyWithdrawals: [],
    });
    expect(
      baseTransactionOptions(context, { deposits, requiredLiveDeposits: [], lock }),
    ).toMatchObject({
      withdrawalRequest: { deposits, lock },
    });
    expect(
      baseTransactionOptions(context, { deposits, requiredLiveDeposits: deposits, lock }),
    ).toMatchObject({
      withdrawalRequest: { deposits, requiredLiveDeposits: deposits, lock },
    });
    expect(conversionKind(true, true)).toBe("direct-plus-order");
    expect(conversionKind(true, false)).toBe("direct");
    expect(conversionKind(false, true)).toBe("order");
    expect(conversionKind(false, false)).toBe("collect-only");
  });

  it("mints order requests with a signer-provided lock", async () => {
    const { sdk, orderManager, lock } = testSdk();
    const mint = vi
      .spyOn(orderManager, "mint")
      .mockImplementation((txLike) => ccc.Transaction.from(txLike));
    const info = Info.create(true, ratio);
    const amounts = { ckbValue: 1n, udtValue: 0n };

    await sdk.request(ccc.Transaction.default(), signerWithLock(lock), info, amounts);

    expect(mint).toHaveBeenCalledWith(expect.any(ccc.Transaction), lock, info, amounts);
  });

  it("mints order requests with a direct lock script", async () => {
    const { sdk, orderManager, lock } = testSdk();
    const mint = vi
      .spyOn(orderManager, "mint")
      .mockImplementation((txLike) => ccc.Transaction.from(txLike));
    const info = Info.create(true, ratio);
    const amounts = { ckbValue: 1n, udtValue: 0n };

    await sdk.request(ccc.Transaction.default(), lock, info, amounts);

    expect(mint).toHaveBeenCalledWith(expect.any(ccc.Transaction), lock, info, amounts);
  });

  it("covers DAO output planning", () => {
    const tx = ccc.Transaction.default();
    const limitError = plannedDaoOutputLimitError(tx, 65, true);

    expect(plannedDaoOutputLimitError(tx, 65, false)).toBeUndefined();
    expect(limitError).toBeInstanceOf(DaoOutputLimitError);
  });
});
