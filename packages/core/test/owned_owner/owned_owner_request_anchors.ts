import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IckbDepositCell } from "../../src/cells.ts";
import {
  clientForDepositHeader,
  REQUEST_WITHDRAWAL_SUITE,
  requestWithdrawalFixture,
} from "./support/owned_owner_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(REQUEST_WITHDRAWAL_SUITE, () => {
  it("rejects duplicated or already spent required live deposit anchors", async () => {
    const { manager, ownerLock, depositHeader, requestedDeposit, requiredLiveDeposit } =
      requestWithdrawalFixture();
    const spentTx = ccc.Transaction.default();
    spentTx.addInput(requiredLiveDeposit.cell);

    await expect(
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [requestedDeposit],
        ownerLock,
        clientForDepositHeader(depositHeader),
        { requiredLiveDeposits: [requiredLiveDeposit, requiredLiveDeposit] },
      ),
    ).rejects.toThrow("Withdrawal live deposit anchor is duplicated");
    await expect(
      manager.requestWithdrawal(
        spentTx,
        [requestedDeposit],
        ownerLock,
        clientForDepositHeader(depositHeader),
        {
          requiredLiveDeposits: [requiredLiveDeposit],
        },
      ),
    ).rejects.toThrow("Withdrawal live deposit anchor is also being spent");
    await expect(
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [requestedDeposit],
        ownerLock,
        clientForDepositHeader(depositHeader),
        { requiredLiveDeposits: [requestedDeposit] },
      ),
    ).rejects.toThrow("Withdrawal live deposit anchor is also being spent");
  });

  it("allows not-ready required live deposit anchors", async () => {
    const { manager, ownerLock, depositHeader, requestedDeposit, requiredLiveDeposit } =
      requestWithdrawalFixture();
    const notReadyLiveDeposit: IckbDepositCell = {
      ...requiredLiveDeposit,
      isReady: false,
    };

    const tx = await manager.requestWithdrawal(
      ccc.Transaction.default(),
      [requestedDeposit],
      ownerLock,
      clientForDepositHeader(depositHeader),
      { requiredLiveDeposits: [notReadyLiveDeposit] },
    );

    expect(tx.cellDeps).toContainEqual(
      ccc.CellDep.from({ outPoint: notReadyLiveDeposit.cell.outPoint, depType: "code" }),
    );
  });
});
