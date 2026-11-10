import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OWNED_OWNER } from "../../../src/constants.ts";
import type { IckbDepositCell, ReceiptCell } from "../../../src/logic.ts";
import { encodeOwnerData, type WithdrawalGroup } from "../../../src/owned_owner.ts";
import { baseTransactionFixture } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import {
  makeOrderGroup,
  resolveOrderGroupFixture,
} from "../../conversion/planning/support/sdk_order_support.ts";
import {
  depositCell,
  readyWithdrawalGroup,
  receiptCell,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseTip, headerLike } from "./support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

interface RealBaseTransactionEffects {
  botLock: ccc.Script;
  dao: ccc.Script;
  depositHeader: ccc.ClientBlockHeader;
  masterCell: ccc.Cell;
  orderCell: ccc.Cell;
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
  expect(tx.outputs[0]?.lock.eq(OWNED_OWNER)).toBe(true);
  expect(tx.outputs[0]?.type?.eq(options.dao)).toBe(true);
  expect(tx.outputs[1]?.lock.eq(options.botLock)).toBe(true);
  expect(tx.outputs[1]?.type?.eq(OWNED_OWNER)).toBe(true);
  expect(tx.outputsData).toEqual([
    ccc.hexFrom(ccc.mol.Uint64LE.encode(options.depositHeader.number)),
    ccc.hexFrom(encodeOwnerData({ ownedDistance: -1n })),
  ]);
  expect(tx.headerDeps).toEqual([
    options.depositHeader.hash,
    options.receiptHeader.hash,
    options.withdrawalHeader.hash,
  ]);
  // Completion, not the builders, adds the iCKB dep group.
  expect(tx.cellDeps).toEqual([]);
  expect(new Set(tx.headerDeps).size).toBe(tx.headerDeps.length);
}

describe("IckbSdk.buildBaseTransaction", () => {
  it("combines the real builders' transaction effects", async () => {
    const { tx, ...effects } = await buildRealBaseTransactionCase();

    expectRealBaseTransactionEffects(tx, effects);
  });
});

async function buildRealBaseTransactionCase(): Promise<
  RealBaseTransactionEffects & { tx: ccc.Transaction }
> {
  const { botLock, dao, logic, sdk } = baseTransactionFixture();
  const depositHeader = headerLike(10n);
  const receiptHeader = headerLike(11n);
  const withdrawalHeader = headerLike(12n);
  const requestedDeposit = depositCell("70", logic, dao, depositHeader, baseTip, {
    isReady: true,
  });
  const orderFixture = makeOrderGroup({
    ownerLock: botLock,
    txHashByte: "72",
  });
  const { orderCell, masterCell } = orderFixture;
  const orderGroup = await resolveOrderGroupFixture(orderFixture);
  const receipt = receiptCell("73", botLock, logic, receiptHeader);
  const withdrawalGroup = readyWithdrawalGroup({
    ownerLock: botLock,
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
    depositHeader,
    masterCell,
    orderCell,
    receipt,
    receiptHeader,
    requestedDeposit,
    withdrawalGroup,
    withdrawalHeader,
  };
}
