import { script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import {
  buildSdkConversionTransaction,
  type TesterState,
} from "../../../../../src/tester/tester/runtime/runtime.ts";
import {
  buildConversionTransactionMock,
  completeTransactionMock,
  emptyAccountState,
  orderGroup,
  receipt,
  runtimeWithSdk,
  systemState,
  withdrawal,
} from "../../../support/runtime/runtime.ts";

describe("buildSdkConversionTransaction", () => {
  it("delegates SDK conversion planning to the SDK", async () => {
    const calls: string[] = [];
    const buildConversionTransaction = buildConversionTransactionMock(calls);
    const completeTransaction = completeTransactionMock(calls);
    const state: TesterState = {
      system: systemState(),
      account: emptyAccountState(),
      userOrders: [],
      conversionContext: {
        system: systemState(),
        receipts: [receipt(1n, 2n)],
        readyWithdrawals: [withdrawal(3n, true)],
        availableOrders: [orderGroup(4n, 5n, false)],
        ckbAvailable: 1000n,
        ickbAvailable: 0n,
        estimatedMaturity: 100n,
      },
      availableCkbBalance: 1000n,
      pendingCkbBalance: 0n,
      totalCkbBalance: 1000n,
      plainCkbBalance: 0n,
      availableIckbBalance: 0n,
      pendingIckbBalance: 0n,
      totalIckbBalance: 0n,
    };
    const primaryLock = script("11");
    const runtime = runtimeWithSdk({
      buildConversionTransaction,
      completeTransaction,
    });
    runtime.primaryLock = primaryLock;

    const result = await buildSdkConversionTransaction(
      runtime,
      state,
      "ckb-to-ickb",
      500n,
    );

    expect(result.conversion).toEqual({ kind: "order" });
    expect(result.conversionNotice).toEqual({
      kind: "maturity-unavailable",
      inputIckb: 500n,
      outputCkb: 499n,
      incentiveCkb: 1n,
      maturityEstimateUnavailable: true,
    });
    expect(buildConversionTransaction.mock.calls[0]?.[1]).toMatchObject({
      direction: "ckb-to-ickb",
      amount: 500n,
      lock: primaryLock,
      context: state.conversionContext,
    });
    expect(completeTransaction.mock.calls[0]?.[1]).toEqual({
      signer: runtime.signer,
      feeRate: 42n,
    });
    expect(calls).toEqual(["conversion", "complete"]);
  });
});
