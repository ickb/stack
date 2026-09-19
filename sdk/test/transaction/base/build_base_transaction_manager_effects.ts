import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnerData } from "../../../src/core/entities.ts";
import type {
  IckbDepositCell,
  ReceiptCell,
  WithdrawalGroup,
} from "../../../src/core/index.ts";
import {
  baseTransactionFixture,
  BUILD_BASE_TRANSACTION_SUITE,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import {
  makeOrderGroup,
  resolveOrderGroupFixture,
} from "../../conversion/planning/support/sdk_order_support.ts";
import {
  depositCell,
  readyWithdrawalGroup,
  receiptCell,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseTip, dep, hash, headerLike } from "./support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

interface RealBaseTransactionEffects {
  botLock: ccc.Script;
  dao: ccc.Script;
  daoDep: ccc.CellDep;
  depositHeader: ccc.ClientBlockHeader;
  logicDep: ccc.CellDep;
  masterCell: ccc.Cell;
  orderCell: ccc.Cell;
  orderDep: ccc.CellDep;
  ownedDep: ccc.CellDep;
  ownedOwner: ccc.Script;
  receipt: ReceiptCell;
  receiptHeader: ccc.ClientBlockHeader;
  requestedDeposit: IckbDepositCell;
  withdrawalGroup: WithdrawalGroup;
  withdrawalHeader: ccc.ClientBlockHeader;
}

function expectRealBaseTransactionEffects(
  tx: ccc.Transaction,
  options: RealBaseTransactionEffects,
): void {
  expect(tx.inputs.map((input) => input.previousOutput.toHex())).toEqual([
    options.requestedDeposit.cell.outPoint.toHex(),
    options.orderCell.outPoint.toHex(),
    options.masterCell.outPoint.toHex(),
    options.receipt.cell.outPoint.toHex(),
    options.withdrawalGroup.owned.cell.outPoint.toHex(),
    options.withdrawalGroup.owner.cell.outPoint.toHex(),
  ]);
  expect(tx.outputs).toHaveLength(2);
  expect(tx.outputs[0]?.capacity).toBe(options.requestedDeposit.cell.cellOutput.capacity);
  expect(tx.outputs[0]?.lock.eq(options.ownedOwner)).toBe(true);
  expect(tx.outputs[0]?.type?.eq(options.dao)).toBe(true);
  expect(tx.outputs[1]?.lock.eq(options.botLock)).toBe(true);
  expect(tx.outputs[1]?.type?.eq(options.ownedOwner)).toBe(true);
  expect(tx.outputsData).toEqual([
    ccc.hexFrom(ccc.mol.Uint64LE.encode(options.depositHeader.number)),
    ccc.hexFrom(OwnerData.encode({ ownedDistance: -1n })),
  ]);
  expect(tx.headerDeps).toEqual([
    options.depositHeader.hash,
    options.receiptHeader.hash,
    options.withdrawalHeader.hash,
  ]);
  expect(tx.cellDeps).toContainEqual(options.daoDep);
  expect(tx.cellDeps).toContainEqual(options.ownedDep);
  expect(tx.cellDeps).toContainEqual(options.logicDep);
  expect(tx.cellDeps).toContainEqual(options.orderDep);
  expect(new Set(tx.headerDeps).size).toBe(tx.headerDeps.length);
}

describe(BUILD_BASE_TRANSACTION_SUITE, () => {
  it("combines real manager transaction effects", async () => {
    const { tx, ...effects } = await buildRealBaseTransactionCase();

    expectRealBaseTransactionEffects(tx, effects);
  });

  it("rejects non-ready withdrawal request deposits before calling core", () => {
    const { botLock, dao, logic, ownedOwnerManager, sdk } = baseTransactionFixture();
    const requestedDeposit = depositCell("74", logic, dao, baseTip, baseTip, {
      isReady: false,
    });
    const requestWithdrawal = vi.spyOn(ownedOwnerManager, "requestWithdrawal");

    expect(() =>
      sdk.buildBaseTransaction(
        ccc.Transaction.default(),
        { availableOrders: [], receipts: [], readyWithdrawals: [] },
        { deposits: [requestedDeposit], lock: botLock },
      ),
    ).toThrow(
      `Withdrawal deposit ${requestedDeposit.cell.outPoint.toHex()} is not ready`,
    );
    expect(requestWithdrawal).not.toHaveBeenCalled();
  });
});

async function buildRealBaseTransactionCase(): Promise<
  RealBaseTransactionEffects & { tx: ccc.Transaction }
> {
  const daoDep = dep("d1");
  const ownedDep = dep("d2");
  const logicDep = dep("d3");
  const orderDep = dep("d4");
  const { botLock, dao, logic, order, orderManager, ownedOwner, sdk, udt } =
    baseTransactionFixture({
      daoDeps: [daoDep],
      logicDeps: [logicDep],
      orderDeps: [orderDep],
      ownedOwnerDeps: [ownedDep],
    });
  const depositHeader = headerLike(10n, { hash: hash("a1") });
  const receiptHeader = headerLike(11n, { hash: hash("a2") });
  const withdrawalHeader = headerLike(12n, { hash: hash("a3") });
  const requestedDeposit = depositCell("70", logic, dao, depositHeader, baseTip, {
    isReady: true,
  });
  const orderFixture = makeOrderGroup({
    orderScript: order,
    udtScript: udt,
    ownerLock: botLock,
    txHashByte: "72",
  });
  const { orderCell, masterCell } = orderFixture;
  const orderGroup = await resolveOrderGroupFixture(orderManager, orderFixture);
  const receipt = receiptCell("73", botLock, logic, receiptHeader);
  const withdrawalGroup = readyWithdrawalGroup({
    ownerLock: botLock,
    ownedOwner,
    dao,
    depositHeader,
    withdrawalHeader,
  });

  const tx = sdk.buildBaseTransaction(
    ccc.Transaction.default(),
    {
      availableOrders: [orderGroup],
      receipts: [receipt],
      readyWithdrawals: [withdrawalGroup],
    },
    { deposits: [requestedDeposit], lock: botLock },
  );

  return {
    tx,
    botLock,
    dao,
    daoDep,
    depositHeader,
    logicDep,
    masterCell,
    orderCell,
    orderDep,
    ownedDep,
    ownedOwner,
    receipt,
    receiptHeader,
    requestedDeposit,
    withdrawalGroup,
    withdrawalHeader,
  };
}
