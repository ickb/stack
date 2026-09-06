import { describe, expect, it } from "vitest";
import {
  buildRawOrderTransaction,
  type TesterState,
} from "../../../../src/tester/runtime/runtime.ts";
import {
  buildBaseTransactionMock,
  completeTransactionMock,
  emptyAccountState,
  orderGroup,
  receipt,
  requestInfo,
  requestMock,
  runtimeWithSdk,
  systemState,
  withdrawal,
} from "../../support/runtime/runtime.ts";

describe("buildRawOrderTransaction", () => {
  it("delegates base construction and completion to the SDK", async () => {
    const calls: string[] = [];
    const buildBaseTransaction = buildBaseTransactionMock(calls);
    const request = requestMock(calls);
    const completeTransaction = completeTransactionMock(calls);
    const receipts = [receipt(1n, 2n)];
    const readyWithdrawals = [withdrawal(3n, true)];
    const state: TesterState = {
      system: systemState(),
      account: emptyAccountState(),
      userOrders: [orderGroup(4n, 5n, false)],
      conversionContext: {
        system: systemState(),
        receipts,
        readyWithdrawals,
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
      availableCkbBalance: 0n,
      pendingCkbBalance: 0n,
      totalCkbBalance: 0n,
      plainCkbBalance: 0n,
      availableIckbBalance: 0n,
      pendingIckbBalance: 0n,
      totalIckbBalance: 0n,
    };
    const runtime = runtimeWithSdk({
      buildBaseTransaction,
      completeTransaction,
      request,
    });

    await buildRawOrderTransaction(runtime, state, [
      { amounts: { ckbValue: 10n, udtValue: 0n }, info: requestInfo() },
    ]);

    expect(buildBaseTransaction.mock.calls[0]?.[1]).toEqual({
      orders: state.userOrders,
      receipts,
      readyWithdrawals,
    });
    expect(completeTransaction.mock.calls[0]?.[1]).toEqual({
      signer: runtime.signer,
      feeRate: 42n,
    });
    expect(calls).toEqual(["base", "request", "complete"]);
  });
});
describe("buildRawOrderTransaction multiple requests", () => {
  it("builds multiple raw order requests in one base transaction", async () => {
    const calls: string[] = [];
    const buildBaseTransaction = buildBaseTransactionMock(calls);
    const request = requestMock(calls);
    const completeTransaction = completeTransactionMock(calls);
    const state: TesterState = {
      system: systemState(),
      account: emptyAccountState(),
      userOrders: [],
      conversionContext: {
        system: systemState(),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
      availableCkbBalance: 0n,
      pendingCkbBalance: 0n,
      totalCkbBalance: 0n,
      plainCkbBalance: 0n,
      availableIckbBalance: 0n,
      pendingIckbBalance: 0n,
      totalIckbBalance: 0n,
    };
    const runtime = runtimeWithSdk({
      buildBaseTransaction,
      completeTransaction,
      request,
    });

    await buildRawOrderTransaction(runtime, state, [
      { amounts: { ckbValue: 10n, udtValue: 0n }, info: requestInfo("first") },
      { amounts: { ckbValue: 20n, udtValue: 0n }, info: requestInfo("second") },
    ]);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map((call) => call[3])).toEqual([
      { ckbValue: 10n, udtValue: 0n },
      { ckbValue: 20n, udtValue: 0n },
    ]);
    expect(calls).toEqual(["base", "request", "request", "complete"]);
  });
});
