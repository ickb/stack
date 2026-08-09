import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IckbDepositCell } from "../../src/cells.ts";
import {
  REQUEST_WITHDRAWAL_SUITE,
  requestWithdrawalFixture,
} from "./support/owned_owner_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(REQUEST_WITHDRAWAL_SUITE, () => {
  it("rejects duplicated or already spent required live deposit anchors", () => {
    const { manager, ownerLock, requestedDeposit, requiredLiveDeposit } =
      requestWithdrawalFixture();
    const spentTx = ccc.Transaction.default();
    spentTx.addInput(requiredLiveDeposit.cell);

    expect(() =>
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [requestedDeposit],
        ownerLock,
        { requiredLiveDeposits: [requiredLiveDeposit, requiredLiveDeposit] },
      ),
    ).toThrow("Withdrawal live deposit anchor is duplicated");
    expect(() =>
      manager.requestWithdrawal(spentTx, [requestedDeposit], ownerLock, {
        requiredLiveDeposits: [requiredLiveDeposit],
      }),
    ).toThrow("Withdrawal live deposit anchor is also being spent");
    expect(() =>
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [requestedDeposit],
        ownerLock,
        { requiredLiveDeposits: [requestedDeposit] },
      ),
    ).toThrow("Withdrawal live deposit anchor is also being spent");
  });

  it("allows not-ready required live deposit anchors", () => {
    const { manager, ownerLock, requestedDeposit, requiredLiveDeposit } =
      requestWithdrawalFixture();
    const notReadyLiveDeposit: IckbDepositCell = {
      ...requiredLiveDeposit,
      isReady: false,
    };

    const tx = manager.requestWithdrawal(
      ccc.Transaction.default(),
      [requestedDeposit],
      ownerLock,
      { requiredLiveDeposits: [notReadyLiveDeposit] },
    );

    expect(tx.cellDeps).toContainEqual(
      ccc.CellDep.from({ outPoint: notReadyLiveDeposit.cell.outPoint, depType: "code" }),
    );
  });
});
