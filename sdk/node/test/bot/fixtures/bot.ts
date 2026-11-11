import { ccc } from "@ckb-ccc/core";
import type { CompleteTransactionResult } from "../../../../src/complete.ts";
import {
  DAO,
  ICKB_LOGIC,
  ICKB_UDT,
  ORDER,
  OWNED_OWNER,
} from "../../../../src/constants.ts";
import type { State, SystemState } from "../../../../src/conversion/types.ts";
import { BOT_LOCK_UP, DAO_DEPOSIT_DATA } from "../../../../src/dao.ts";
import {
  encodeReceiptData,
  type IckbDepositCell,
  type ReceiptCell,
} from "../../../../src/logic.ts";
import { MasterCell, OrderCell, OrderGroup } from "../../../../src/order/cells.ts";
import { Info } from "../../../../src/order/info.ts";
import type { Match } from "../../../../src/order/matcher.ts";
import { findOrders } from "../../../../src/order/order.ts";
import { OrderData } from "../../../../src/order/order_data.ts";
import { Ratio } from "../../../../src/order/ratio.ts";
import {
  encodeOwnerData,
  OwnerCell,
  WithdrawalGroup,
} from "../../../../src/owned_owner.ts";
import type { SignAndSendTransactionResult } from "../../../../src/send/sign_and_send_transaction.ts";
import type { readRawState } from "../../../../src/state.ts";
import { ckbFromUdt, ICKB_DEPOSIT_CAP } from "../../../../src/udt.ts";

import {
  byte32FromByte,
  committedTransactionResponse,
  FRESH_BLOCK,
  headerLike,
  script,
  StubClient,
  type StubCell,
} from "@ickb/testkit";
import type { Runtime } from "../../../src/bot/types.ts";

type TestWithdrawalRequestCell = ConstructorParameters<typeof WithdrawalGroup>[0];

export interface BotRuntimeOptions {
  client?: ccc.Client;
  completeTransaction?: Runtime["completeTransaction"];
  sendTransaction?: Runtime["sendTransaction"];
  primaryLock?: ccc.Script;
}

export const hash = byte32FromByte;
/** Plain change the default test completion returns: comfortably above the reserve. */
export const FUNDED_CHANGE = ccc.fixedPointFrom(2000);
/** The fee every test completion reports as planned. */
export const PLANNED_FEE = 1000n;
/** An iCKB balance inside the band: above the refill line, below the withdrawal line. */
export const BAND_ICKB_BALANCE = ccc.fixedPointFrom(50_000);
export const NO_DEPOSITS: IckbDepositCell[] = [];

/** The bot tests' tip: epoch zero, so a deposit's claim is `minutesOut` on the nominal epoch. */
export const BOT_TIP = headerLike({ epoch: [0n, 0n, 1n] });

/**
 * A pool deposit shaped for the real DAO and owned-owner builders, with the iCKB value and
 * claim the tests dictate rather than the ones the cell would imply: `minutesOut` past
 * `BOT_TIP` on the nominal four-hour epoch, ready under `BOT_LOCK_UP` between twenty and
 * sixty; a whole number of epochs out places it in another ring segment.
 */
export function readyDeposit(
  byte: string,
  udtValue: bigint,
  minutesOut = 30n,
): IckbDepositCell {
  const tip = headerLike({ epoch: [1n, 0n, 1n], number: 0n });
  const cell = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100_082),
      lock: ICKB_LOGIC,
      type: DAO,
    },
    outputData: DAO_DEPOSIT_DATA,
  });
  return {
    cell,
    header: tip,
    claimEpoch: ccc.Epoch.from([minutesOut / 240n, minutesOut % 240n, 240n]),
    ckbValue: udtValue,
    udtValue,
  };
}

/** A receipt of one cap-sized deposit at the default primary lock. */
export function testReceipt(byte: string): ReceiptCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(218),
      lock: script("11"),
      type: ICKB_LOGIC,
    },
    outputData: encodeReceiptData({
      depositQuantity: 1n,
      depositAmount: ICKB_DEPOSIT_CAP,
    }),
  });
  const { capacity } = cell.cellOutput;
  return { cell, ckbValue: capacity, udtValue: ICKB_DEPOSIT_CAP, header: BOT_TIP };
}

/** A partial that pays the matcher `ckbDelta` CKB and `udtDelta` iCKB out of a real order. */
export async function testMatch(
  byte: string,
  { ckbDelta = 0n, udtDelta = 0n }: { ckbDelta?: bigint; udtDelta?: bigint } = {},
): Promise<Match["partials"][number]> {
  const group = await testOrderGroup(byte);
  return {
    group,
    ckbOut: group.order.ckbValue - ckbDelta,
    udtOut: group.order.udtValue - udtDelta,
  };
}

/**
 * A market order the resolver would return, from the bot's side: a buyer offers CKB for
 * iCKB at the ratio, a seller iCKB for CKB, and the minimum match is the exponent.
 */
export function marketOrder({
  byte,
  ckb,
  udt,
  ratio,
  ckbMinMatchLog = 0,
}: {
  byte: string;
  ckb: bigint;
  udt: bigint;
  ratio: { ckbScale: bigint; udtScale: bigint };
  ckbMinMatchLog?: number;
}): OrderGroup {
  // A mint order: its master sits one output later in the same transaction.
  const masterOutPoint = { txHash: hash(byte), index: 1n };
  const outputData = OrderData.from({
    udtValue: udt,
    master: { type: "relative", value: { distance: 1n, padding: new Uint8Array(32) } },
    info: Info.from({
      ckbToUdt: ckb > 0n ? ratio : Ratio.empty(),
      udtToCkb: udt > 0n ? ratio : Ratio.empty(),
      ckbMinMatchLog,
    }),
  }).toBytes();
  const minimal = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: { lock: ORDER, type: ICKB_UDT },
    outputData,
  });
  const order = OrderCell.mustFrom(
    ccc.Cell.from({
      outPoint: minimal.outPoint,
      cellOutput: {
        capacity: minimal.cellOutput.capacity + ckb,
        lock: ORDER,
        type: ICKB_UDT,
      },
      outputData,
    }),
    FRESH_BLOCK,
  );
  const master = new MasterCell(
    ccc.Cell.from({
      outPoint: masterOutPoint,
      cellOutput: {
        capacity: ccc.fixedPointFrom(74),
        lock: script("54"),
        type: ORDER,
      },
      outputData: "0x",
    }),
  );
  return new OrderGroup(master, order, order);
}

/** A withdrawal request under the owned-owner lock with its owner marker one output later. */
export function testWithdrawal(
  byte: string,
  distinct?: number,
  isReady = true,
): WithdrawalGroup {
  // `distinct` numbers the request and its deposit header past what one byte can, so a
  // test can hold more withdrawals than the DAO script addresses in one transaction.
  const txHash =
    distinct === undefined ? hash(byte) : ccc.hexFrom(ccc.numToBytes(distinct, 32));
  const depositHash =
    distinct === undefined
      ? hash("d0")
      : ccc.hexFrom(ccc.numToBytes(distinct + 1_000_000, 32));
  const depositHeader = headerLike({ number: 1n, hash: depositHash });
  const requestHeader = headerLike({ number: 2n, hash: hash("d1") });
  const cell = ccc.Cell.from({
    outPoint: { txHash, index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100_082),
      lock: OWNED_OWNER,
      type: DAO,
    },
    outputData: ccc.hexFrom(ccc.numLeToBytes(1n, 8)),
  });
  const owned: TestWithdrawalRequestCell = {
    cell,
    headers: [depositHeader, requestHeader],
    maturity: new TestEpoch(0n, 0n, 1n, 0n),
    isReady,
    ckbValue: cell.cellOutput.capacity,
  };
  const owner = new OwnerCell(
    ccc.Cell.from({
      outPoint: { txHash, index: 1n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100),
        lock: script("11"),
        type: OWNED_OWNER,
      },
      outputData: encodeOwnerData({ ownedDistance: -1n }),
    }),
  );
  return new WithdrawalGroup(owned, owner);
}

/**
 * A runtime with stubbed completion and send: the real builders mutate transactions in
 * place and assert their inputs, which is what the bot tests must exercise.
 */
export function botRuntime(overrides: BotRuntimeOptions = {}): Runtime {
  const client = overrides.client ?? new StubClient();
  const primaryLock = overrides.primaryLock ?? script("11");

  return {
    client,
    accountLocks: [primaryLock],
    // The default completion models a funded account: it hands the reserve back as change.
    completeTransaction:
      overrides.completeTransaction ??
      (async (tx): Promise<CompleteTransactionResult> => {
        await Promise.resolve();
        const completed = ccc.Transaction.from(tx).clone();
        completed.addOutput({ capacity: FUNDED_CHANGE, lock: primaryLock }, "0x");
        return { ok: true, tx: completed, plannedFee: PLANNED_FEE };
      }),
    sendTransaction:
      overrides.sendTransaction ??
      (async (): Promise<SignAndSendTransactionResult> => {
        await Promise.resolve();
        return { ok: true, txHash: hash("ff") };
      }),
  };
}

/** The bot tests' system state: an empty pool and book at a one-to-one rate. */
export function botSystem(): SystemState {
  const exchangeRatio = Ratio.from({ ckbScale: 1n, udtScale: 1n });
  return {
    feeRate: 1n,
    exchangeRatio,
    depositCapacity: ckbFromUdt(ICKB_DEPOSIT_CAP, exchangeRatio),
    tip: BOT_TIP,
    orderBook: [],
    poolDeposits: [],
    lockUp: BOT_LOCK_UP,
  };
}

/** A bot state: an empty account on `botSystem()`, with the fields the test names replaced. */
export function botState(overrides: Partial<State> = {}): State {
  return {
    ...botSystem(),
    // `botRuntime()`'s primary lock.
    changeLock: script("11"),
    cells: [],
    receipts: [],
    readyWithdrawals: [],
    pendingWithdrawals: [],
    availableOrders: [],
    pendingOrders: [],
    hasCollectable: false,
    ckbNative: 0n,
    ickbNative: 0n,
    ckbAvailable: 0n,
    ickbAvailable: 0n,
    ckbConvertible: 0n,
    ickbConvertible: 0n,
    ckbBalance: 0n,
    ickbBalance: 0n,
    estimatedMaturity: 0n,
    ...overrides,
  };
}

/**
 * An order carrying 100 CKB and 1000 iCKB under the testnet order scripts, produced by the
 * resolver because the builders accept nothing else; its master sits one output later.
 */
async function testOrderGroup(byte: string): Promise<OrderGroup> {
  const outputData = OrderData.from({
    udtValue: ccc.fixedPointFrom(1000),
    master: { type: "relative", value: { distance: 1n, padding: new Uint8Array(32) } },
    info: {
      ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      udtToCkb: Ratio.empty(),
      ckbMinMatchLog: 0,
    },
  }).toBytes();
  const minimal = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 1n },
    cellOutput: { lock: ORDER, type: ICKB_UDT },
    outputData,
  });
  const order = ccc.Cell.from({
    outPoint: minimal.outPoint,
    cellOutput: {
      capacity: minimal.cellOutput.capacity + ccc.fixedPointFrom(100),
      lock: ORDER,
      type: ICKB_UDT,
    },
    outputData,
  });
  const master = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 2n },
    cellOutput: { capacity: ccc.fixedPointFrom(74), lock: script("54"), type: ORDER },
    outputData: "0x",
  });
  const mint = ccc.Transaction.default();
  mint.outputs.push(
    ccc.CellOutput.from({ capacity: 0n, lock: script("00") }),
    order.cellOutput,
    master.cellOutput,
  );
  mint.outputsData.push("0x", order.outputData, master.outputData);
  const client = new StubClient({
    cache: new ccc.ClientCacheMemory(),
    cells: (query): readonly StubCell[] => [
      query.script_type === "lock" ? order : master,
    ],
    getTransaction: async (): ReturnType<ccc.Client["getTransaction"]> => {
      await Promise.resolve();
      return committedTransactionResponse(mint);
    },
  });
  const groups = await findOrders(client);
  const group = groups[0];
  if (group === undefined || groups.length !== 1) {
    throw new Error("Expected one resolver-produced order fixture");
  }
  return group;
}

export type L1AccountState = Awaited<ReturnType<typeof readRawState>>;

export function l1AccountState(
  account: Partial<L1AccountState["account"]> = {},
): L1AccountState {
  return {
    system: botSystem(),
    userOrders: [],
    account: {
      capacityCells: [],
      nativeUdtCells: [],
      receipts: [],
      withdrawalGroups: [],
      ...account,
    },
  };
}

class TestEpoch extends ccc.Epoch {
  private readonly unix: bigint;

  constructor(integer: bigint, numerator: bigint, denominator: bigint, unix: bigint) {
    super(integer, numerator, denominator);
    this.unix = unix;
  }

  public override add(epoch: ccc.EpochLike): ccc.Epoch {
    const added = super.add(epoch);
    return new TestEpoch(
      added.integer,
      added.numerator,
      added.denominator,
      this.unix + 16n,
    );
  }

  public override toUnix(): bigint {
    return this.unix;
  }
}
