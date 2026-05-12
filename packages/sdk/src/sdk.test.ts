import { ccc } from "@ckb-ccc/core";
import {
  Info,
  MasterCell,
  OrderCell,
  OrderData,
  OrderGroup,
  Ratio,
} from "@ickb/order";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DaoManager, DaoOutputLimitError } from "@ickb/dao";
import {
  ICKB_DEPOSIT_CAP,
  convert,
  type IckbDepositCell,
  LogicManager,
  OwnerCell,
  OwnerData,
  OwnedOwnerManager,
  ReceiptData,
  type ReceiptCell,
  WithdrawalGroup,
} from "@ickb/core";
import { OrderManager } from "@ickb/order";
import { headerLike as testHeaderLike, hash, script } from "@ickb/testkit";
import { defaultFindCellsLimit } from "@ickb/utils";
import {
  completeIckbTransaction,
  estimateMaturityFeeThreshold,
  IckbSdk,
  MAX_DIRECT_DEPOSITS,
  projectAccountAvailability,
  sendAndWaitForCommit,
  TransactionConfirmationError,
  type SystemState,
} from "./sdk.js";

const ratio = Ratio.from({ ckbScale: 1n, udtScale: 1n });

function headerLike(
  number: bigint,
  overrides: Partial<ccc.ClientBlockHeader> = {},
): ccc.ClientBlockHeader {
  return testHeaderLike({
    epoch: [1n, 0n, 1n],
    number,
    ...overrides,
  });
}

const tip = headerLike(0n);

function fakeIckbUdt(udt = script("66")): {
  isUdt: (cell: ccc.Cell) => boolean;
  infoFrom: () => Promise<never>;
  completeBy: (txLike: ccc.TransactionLike) => Promise<ccc.Transaction>;
} {
  return {
    isUdt: (cell: ccc.Cell): boolean => cell.cellOutput.type?.eq(udt) ?? false,
    infoFrom: () => Promise.resolve({ capacity: 0n, balance: 0n, count: 0 } as never),
    completeBy: async (txLike: ccc.TransactionLike): Promise<ccc.Transaction> => {
      await Promise.resolve();
      return ccc.Transaction.from(txLike);
    },
  };
}

async function* once<T>(value: T): AsyncGenerator<T> {
  yield value;
  await Promise.resolve();
}

async function* none<T>(): AsyncGenerator<T> {
  await Promise.resolve();
  yield* [] as T[];
}

async function* repeat<T>(count: number, value: T): AsyncGenerator<T> {
  for (let index = 0; index < count; index += 1) {
    yield value;
  }
  await Promise.resolve();
}

function orderGroup(options: {
  ckbValue: bigint;
  udtValue: bigint;
  isDualRatio: boolean;
  isMatchable: boolean;
}): OrderGroup {
  return {
    ckbValue: options.ckbValue,
    udtValue: options.udtValue,
    order: {
      isDualRatio: () => options.isDualRatio,
      isMatchable: () => options.isMatchable,
    },
  } as unknown as OrderGroup;
}

function readyDeposit(
  udtValue: bigint,
  maturityUnix = 0n,
  options: { ckbValue?: bigint; id?: string } = {},
): IckbDepositCell {
  return {
    cell: ccc.Cell.from({
      outPoint: { txHash: hash(options.id ?? "aa"), index: maturityUnix },
      cellOutput: { capacity: 0n, lock: script("22") },
      outputData: "0x",
    }),
    headers: [],
    interests: 0n,
    isReady: true,
    isDeposit: true,
    ckbValue: options.ckbValue ?? udtValue,
    udtValue,
    maturity: { toUnix: (): bigint => maturityUnix },
  } as unknown as IckbDepositCell;
}

function transactionWithOutputs(count: number, lock: ccc.Script): ccc.Transaction {
  const tx = ccc.Transaction.default();
  for (let index = 0; index < count; index += 1) {
    tx.outputs.push(ccc.CellOutput.from({ capacity: 1n, lock }));
    tx.outputsData.push("0x");
  }
  return tx;
}

function testSdk(): {
  sdk: IckbSdk;
  logicManager: LogicManager;
  ownedOwnerManager: OwnedOwnerManager;
  orderManager: OrderManager;
  lock: ccc.Script;
} {
  const lock = script("11");
  const logicManager = new LogicManager(script("22"), [], new DaoManager(script("33"), []));
  const ownedOwnerManager = new OwnedOwnerManager(
    script("44"),
    [],
    new DaoManager(script("33"), []),
  );
  const orderManager = new OrderManager(script("55"), [], script("66"));
  return {
    sdk: new IckbSdk(
      fakeIckbUdt(),
      ownedOwnerManager,
      logicManager,
      orderManager,
      [],
    ),
    logicManager,
    ownedOwnerManager,
    orderManager,
    lock,
  };
}

function system(overrides: Partial<SystemState> = {}): SystemState {
  return {
    feeRate: 1n,
    tip,
    exchangeRatio: ratio,
    orderPool: [],
    ckbAvailable: 0n,
    ckbMaturing: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IckbSdk.estimate", () => {
  it("exposes the fee threshold used for maturity previews", () => {
    expect(estimateMaturityFeeThreshold(system({ feeRate: 7n }))).toBe(70n);
  });

  it("omits maturity below the fee threshold", () => {
    const result = IckbSdk.estimate(
      false,
      { ckbValue: 0n, udtValue: 100000n },
      system({ ckbAvailable: 100000n }),
    );

    expect(result.convertedAmount).toBe(99999n);
    expect(result.ckbFee).toBe(1n);
    expect(result.maturity).toBeUndefined();
  });

  it("uses the chain tip timestamp for preview maturity", () => {
    const result = IckbSdk.estimate(
      false,
      { ckbValue: 0n, udtValue: 1000000n },
      system({
        ckbAvailable: 1000000n,
        tip: headerLike(0n, { timestamp: 1234n }),
      }),
    );

    expect(result.convertedAmount).toBe(999990n);
    expect(result.ckbFee).toBe(10n);
    expect(result.maturity).toBe(601234n);
  });

  it("uses UDT-to-CKB fee units when deciding preview maturity", () => {
    const result = IckbSdk.estimate(
      false,
      { ckbValue: 0n, udtValue: 100n },
      system({
        exchangeRatio: Ratio.from({ ckbScale: 2n, udtScale: 1n }),
        ckbAvailable: 100n,
      }),
      { fee: 1n, feeBase: 10n },
    );

    expect(result.convertedAmount).toBe(45n);
    expect(result.ckbFee).toBe(5n);
    expect(result.maturity).toBeUndefined();
  });

  it("uses the fee-adjusted CKB output for UDT-to-CKB maturity", () => {
    const exchangeRatio = Ratio.from({
      ckbScale: 10000000000000000n,
      udtScale: 10008200000000000n,
    });

    const result = IckbSdk.estimate(
      false,
      { ckbValue: 0n, udtValue: ccc.fixedPointFrom("100000.001") },
      system({
        exchangeRatio,
        ckbAvailable: ccc.fixedPointFrom(100082),
      }),
    );

    expect(result.convertedAmount).toBeLessThan(ccc.fixedPointFrom(100082));
    expect(result.maturity).toBe(600000n);
  });

  it("builds normal iCKB-to-CKB orders when maturity is unavailable", () => {
    const result = IckbSdk.estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1000000n },
      system({ ckbAvailable: 0n }),
    );

    expect(result).toBeDefined();
    expect(result?.maturity).toBeUndefined();
    expect(result?.notice).toEqual({
      kind: "maturity-unavailable",
      inputIckb: 1000000n,
      outputCkb: 999990n,
      incentiveCkb: 10n,
      maturityEstimateUnavailable: true,
    });
    expect(result?.estimate.info.ckbMinMatchLog).toBe(33);
  });

  it("builds tiny iCKB-to-CKB orders with explicit dust terms", () => {
    const result = IckbSdk.estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1n },
      system({ ckbAvailable: 1n, tip: headerLike(0n, { timestamp: 1234n }) }),
    );

    expect(result).toBeDefined();
    expect(result?.maturity).toBe(601234n);
    expect(result?.notice).toEqual({
      kind: "dust-ickb-to-ckb",
      inputIckb: 1n,
      outputCkb: 1n,
      incentiveCkb: 0n,
      maturityEstimateUnavailable: false,
    });
    expect(result?.estimate.info.ckbMinMatchLog).toBe(33);
  });

});

describe("IckbSdk.maturity", () => {
  it("returns undefined for dual-ratio orders", () => {
    const dualRatio = new Info(ratio, ratio, 1);

    expect(
      IckbSdk.maturity(
        { info: dualRatio, amounts: { ckbValue: 1n, udtValue: 1n } },
        system(),
      ),
    ).toBeUndefined();
  });

  it("returns zero for already fulfilled orders", () => {
    expect(
      IckbSdk.maturity(
        {
          info: Info.create(true, ratio),
          amounts: { ckbValue: 0n, udtValue: 0n },
        },
        system(),
      ),
    ).toBe(0n);
  });

  it("returns the baseline maturity when enough CKB is already available", () => {
    expect(
      IckbSdk.maturity(
        {
          info: Info.create(false, ratio),
          amounts: { ckbValue: 0n, udtValue: 100n },
        },
        system({
          ckbAvailable: 100n,
          tip: headerLike(0n, { timestamp: 1234n }),
        }),
      ),
    ).toBe(601234n);
  });

  it("picks the first matching maturing CKB entry", () => {
    expect(
      IckbSdk.maturity(
        {
          info: Info.create(false, ratio),
          amounts: { ckbValue: 0n, udtValue: 100n },
        },
        system({
          ckbMaturing: [
            { ckbCumulative: 50n, maturity: 1000n },
            { ckbCumulative: 100n, maturity: 2000n },
            { ckbCumulative: 150n, maturity: 3000n },
          ],
        }),
      ),
    ).toBe(2000n);
  });

  it("counts existing CKB in UDT-to-CKB orders before requiring pool liquidity", () => {
    const info = Info.create(false, {
      ckbScale: 9n,
      udtScale: 10n,
    });

    expect(
      IckbSdk.maturity(
        {
          info,
          amounts: {
            ckbValue: 7n,
            udtValue: 10n,
          },
        },
        system({
          ckbMaturing: [
            { ckbCumulative: 5n, maturity: 1000n },
            { ckbCumulative: 6n, maturity: 2000n },
          ],
        }),
      ),
    ).toBe(1000n);
  });
});

describe("projectAccountAvailability", () => {
  it("splits actionable and pending account value", () => {
    const readyWithdrawal = { owned: { isReady: true }, ckbValue: 11n, udtValue: 13n };
    const pendingWithdrawal = {
      owned: { isReady: false },
      ckbValue: 17n,
      udtValue: 19n,
    };
    const availableOrder = orderGroup({
      ckbValue: 23n,
      udtValue: 29n,
      isDualRatio: true,
      isMatchable: true,
    });
    const pendingOrder = orderGroup({
      ckbValue: 31n,
      udtValue: 37n,
      isDualRatio: false,
      isMatchable: true,
    });

    const projection = projectAccountAvailability(
      {
        capacityCells: [{ cellOutput: { capacity: 3n } } as ccc.Cell],
        nativeUdtCells: [],
        nativeUdtCapacity: 5n,
        nativeUdtBalance: 7n,
        receipts: [{ ckbValue: 41n, udtValue: 43n } as ReceiptCell],
        withdrawalGroups: [
          readyWithdrawal as WithdrawalGroup,
          pendingWithdrawal as WithdrawalGroup,
        ],
      },
      [availableOrder, pendingOrder],
    );

    expect(projection.readyWithdrawals).toEqual([readyWithdrawal]);
    expect(projection.pendingWithdrawals).toEqual([pendingWithdrawal]);
    expect(projection.availableOrders).toEqual([availableOrder]);
    expect(projection.pendingOrders).toEqual([pendingOrder]);
    expect(projection.ckbNative).toBe(3n);
    expect(projection.ickbNative).toBe(7n);
    expect(projection.ckbAvailable).toBe(3n + 41n + 11n + 23n);
    expect(projection.ickbAvailable).toBe(7n + 43n + 29n);
    expect(projection.ckbPending).toBe(17n + 31n);
    expect(projection.ickbPending).toBe(37n);
    expect(projection.ckbBalance).toBe(projection.ckbAvailable + projection.ckbPending);
    expect(projection.ickbBalance).toBe(
      projection.ickbAvailable + projection.ickbPending,
    );
  });

  it("treats non-matchable user orders as actionable", () => {
    const nonMatchable = orderGroup({
      ckbValue: 23n,
      udtValue: 29n,
      isDualRatio: false,
      isMatchable: false,
    });

    const projection = projectAccountAvailability(
      {
        capacityCells: [],
        nativeUdtCells: [],
        nativeUdtCapacity: 0n,
        nativeUdtBalance: 0n,
        receipts: [],
        withdrawalGroups: [],
      },
      [nonMatchable],
    );

    expect(projection.availableOrders).toEqual([nonMatchable]);
    expect(projection.pendingOrders).toEqual([]);
    expect(projection.ckbAvailable).toBe(23n);
    expect(projection.ickbAvailable).toBe(29n);
  });

  it("keeps matchable non-dual orders pending by default", () => {
    const matchable = orderGroup({
      ckbValue: 31n,
      udtValue: 37n,
      isDualRatio: false,
      isMatchable: true,
    });

    const projection = projectAccountAvailability(
      {
        capacityCells: [],
        nativeUdtCells: [],
        nativeUdtCapacity: 0n,
        nativeUdtBalance: 0n,
        receipts: [],
        withdrawalGroups: [],
      },
      [matchable],
    );

    expect(projection.availableOrders).toEqual([]);
    expect(projection.pendingOrders).toEqual([matchable]);
    expect(projection.ckbAvailable).toBe(0n);
    expect(projection.ickbAvailable).toBe(0n);
    expect(projection.ckbPending).toBe(31n);
    expect(projection.ickbPending).toBe(37n);
  });

  it("can budget collected matchable orders as available", () => {
    const matchable = orderGroup({
      ckbValue: 31n,
      udtValue: 37n,
      isDualRatio: false,
      isMatchable: true,
    });

    const projection = projectAccountAvailability(
      {
        capacityCells: [],
        nativeUdtCells: [],
        nativeUdtCapacity: 0n,
        nativeUdtBalance: 0n,
        receipts: [],
        withdrawalGroups: [],
      },
      [matchable],
      { collectedOrdersAvailable: true },
    );

    expect(projection.availableOrders).toEqual([matchable]);
    expect(projection.pendingOrders).toEqual([]);
    expect(projection.ckbAvailable).toBe(31n);
    expect(projection.ickbAvailable).toBe(37n);
    expect(projection.ckbPending).toBe(0n);
    expect(projection.ickbPending).toBe(0n);
  });

  it("does not count native UDT capacity as spendable CKB", () => {
    const projection = projectAccountAvailability(
      {
        capacityCells: [{ cellOutput: { capacity: 3n } } as ccc.Cell],
        nativeUdtCells: [],
        nativeUdtCapacity: 5n,
        nativeUdtBalance: 7n,
        receipts: [],
        withdrawalGroups: [],
      },
      [],
    );

    expect(projection.ckbNative).toBe(3n);
    expect(projection.ckbAvailable).toBe(3n);
    expect(projection.ckbBalance).toBe(3n);
  });

  it("does not count withdrawal UDT as available or pending iCKB", () => {
    const projection = projectAccountAvailability(
      {
        capacityCells: [],
        nativeUdtCells: [],
        nativeUdtCapacity: 0n,
        nativeUdtBalance: 7n,
        receipts: [],
        withdrawalGroups: [
          { owned: { isReady: true }, ckbValue: 11n, udtValue: 13n },
          { owned: { isReady: false }, ckbValue: 17n, udtValue: 19n },
        ] as WithdrawalGroup[],
      },
      [],
    );

    expect(projection.ckbAvailable).toBe(11n);
    expect(projection.ckbPending).toBe(17n);
    expect(projection.ickbAvailable).toBe(7n);
    expect(projection.ickbPending).toBe(0n);
    expect(projection.ickbBalance).toBe(7n);
  });
});

describe("IckbSdk.buildBaseTransaction", () => {
  it("requests withdrawals before input-only base activity", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const daoManager = new DaoManager(dao, []);
    const logicManager = new LogicManager(logic, [], daoManager);
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], daoManager);
    const orderManager = new OrderManager(order, [], udt);
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      logicManager,
      orderManager,
      [botLock],
    );
    const steps: string[] = [];
    const requestedDeposit = depositCell("80", logic, dao, tip, tip, {
      isReady: true,
    });
    const requiredLiveDeposit = {
      cell: ccc.Cell.from({
        outPoint: { txHash: hash("90"), index: 0n },
        cellOutput: { capacity: 1n, lock: logic },
        outputData: "0x",
      }),
      isReady: true,
    } as IckbDepositCell;

    vi.spyOn(ownedOwnerManager, "requestWithdrawal").mockImplementation(
      async (txLike, deposits, lock, _client, requestOptions) => {
        await Promise.resolve();
        steps.push("request");
        expect(deposits).toEqual([requestedDeposit]);
        expect(lock).toEqual(botLock);
        expect(requestOptions).toEqual({ requiredLiveDeposits: [requiredLiveDeposit] });
        const tx = ccc.Transaction.from(txLike);
        expect(tx.inputs).toHaveLength(0);
        expect(tx.outputs).toHaveLength(0);
        tx.inputs.push(
          ccc.CellInput.from({
            previousOutput: {
              txHash: hash("70"),
              index: 0n,
            },
          }),
        );
        tx.outputs.push(
          ccc.CellOutput.from({
            capacity: 1n,
            lock: botLock,
          }),
        );
        tx.outputsData.push("0x");
        return tx;
      },
    );
    vi.spyOn(orderManager, "melt").mockImplementation((txLike) => {
      steps.push("orders");
      const tx = ccc.Transaction.from(txLike);
      expect(tx.inputs).toHaveLength(1);
      expect(tx.outputs).toHaveLength(1);
      tx.inputs.push(
        ccc.CellInput.from({
          previousOutput: {
            txHash: hash("71"),
            index: 0n,
          },
        }),
      );
      return tx;
    });
    vi.spyOn(logicManager, "completeDeposit").mockImplementation((txLike) => {
      steps.push("receipts");
      const tx = ccc.Transaction.from(txLike);
      expect(tx.inputs).toHaveLength(2);
      expect(tx.outputs).toHaveLength(1);
      tx.inputs.push(
        ccc.CellInput.from({
          previousOutput: {
            txHash: hash("72"),
            index: 0n,
          },
        }),
      );
      return tx;
    });
    vi.spyOn(ownedOwnerManager, "withdraw").mockImplementation(async (txLike) => {
      await Promise.resolve();
      steps.push("withdrawals");
      const tx = ccc.Transaction.from(txLike);
      expect(tx.inputs).toHaveLength(3);
      expect(tx.outputs).toHaveLength(1);
      tx.inputs.push(
        ccc.CellInput.from({
          previousOutput: {
            txHash: hash("73"),
            index: 0n,
          },
        }),
      );
      return tx;
    });

    const tx = await sdk.buildBaseTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      withdrawalRequest: {
        deposits: [requestedDeposit],
        requiredLiveDeposits: [requiredLiveDeposit],
        lock: botLock,
      },
      orders: [{} as OrderGroup],
      receipts: [{} as ReceiptCell],
      readyWithdrawals: [{} as WithdrawalGroup],
    });

    expect(steps).toEqual(["request", "orders", "receipts", "withdrawals"]);
    expect(tx.inputs).toHaveLength(4);
    expect(tx.outputs).toHaveLength(1);
    expect(tx.outputsData).toEqual(["0x"]);
  });

  it("combines real manager transaction effects", async () => {
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);

    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const daoDep = dep("d1");
    const ownedDep = dep("d2");
    const logicDep = dep("d3");
    const orderDep = dep("d4");
    const daoManager = new DaoManager(dao, [daoDep]);
    const logicManager = new LogicManager(logic, [logicDep], daoManager);
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [ownedDep], daoManager);
    const orderManager = new OrderManager(order, [orderDep], udt);
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      logicManager,
      orderManager,
      [botLock],
    );
    const depositHeader = headerLike(10n, { hash: hash("a1") });
    const receiptHeader = headerLike(11n, { hash: hash("a2") });
    const withdrawalHeader = headerLike(12n, { hash: hash("a3") });
    const requestedDeposit = depositCell("70", logic, dao, depositHeader, tip, {
      isReady: true,
    });
    const requiredLiveDeposit = depositCell("71", logic, dao, depositHeader, tip, {
      isReady: true,
    });
    const { group: orderGroup, orderCell, masterCell } = makeOrderGroup({
      orderScript: order,
      udtScript: udt,
      ownerLock: botLock,
      txHashByte: "72",
    });
    const receipt = receiptCell("73", botLock, logic, receiptHeader);
    const withdrawalGroup = readyWithdrawalGroup({
      ownerLock: botLock,
      ownedOwner,
      dao,
      depositHeader,
      withdrawalHeader,
    });

    const tx = await sdk.buildBaseTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      withdrawalRequest: {
        deposits: [requestedDeposit],
        requiredLiveDeposits: [requiredLiveDeposit],
        lock: botLock,
      },
      orders: [orderGroup],
      receipts: [receipt],
      readyWithdrawals: [withdrawalGroup],
    });

    expect(tx.inputs.map((input) => input.previousOutput.toHex())).toEqual([
      requestedDeposit.cell.outPoint.toHex(),
      orderCell.outPoint.toHex(),
      masterCell.outPoint.toHex(),
      receipt.cell.outPoint.toHex(),
      withdrawalGroup.owned.cell.outPoint.toHex(),
      withdrawalGroup.owner.cell.outPoint.toHex(),
    ]);
    expect(tx.outputs).toHaveLength(2);
    expect(tx.outputs[0]?.capacity).toBe(requestedDeposit.cell.cellOutput.capacity);
    expect(tx.outputs[0]?.lock.eq(ownedOwner)).toBe(true);
    expect(tx.outputs[0]?.type?.eq(dao)).toBe(true);
    expect(tx.outputs[1]?.lock.eq(botLock)).toBe(true);
    expect(tx.outputs[1]?.type?.eq(ownedOwner)).toBe(true);
    expect(tx.outputsData).toEqual([
      ccc.hexFrom(ccc.mol.Uint64LE.encode(depositHeader.number)),
      ccc.hexFrom(OwnerData.encode({ ownedDistance: -1n })),
    ]);
    expect(tx.headerDeps).toEqual([
      depositHeader.hash,
      receiptHeader.hash,
      withdrawalHeader.hash,
    ]);
    expect(tx.cellDeps).toContainEqual(daoDep);
    expect(tx.cellDeps).toContainEqual(ownedDep);
    expect(tx.cellDeps).toContainEqual(logicDep);
    expect(tx.cellDeps).toContainEqual(orderDep);
    expect(tx.cellDeps).toContainEqual(
      ccc.CellDep.from({
        outPoint: requiredLiveDeposit.cell.outPoint,
        depType: "code",
      }),
    );
    expect(new Set(tx.headerDeps).size).toBe(tx.headerDeps.length);
  });

  it("accepts withdrawal requests after balanced caller activity", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const daoManager = new DaoManager(dao, []);
    const logicManager = new LogicManager(logic, [], daoManager);
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], daoManager);
    const orderManager = new OrderManager(order, [], udt);
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      logicManager,
      orderManager,
      [botLock],
    );
    const requestedDeposit = depositCell("85", logic, dao, tip, tip, {
      isReady: true,
    });
    const baseTx = ccc.Transaction.default();
    baseTx.inputs.push(
      ccc.CellInput.from({
        previousOutput: {
          txHash: hash("80"),
          index: 0n,
        },
      }),
    );
    baseTx.outputs.push(
      ccc.CellOutput.from({
        capacity: 1n,
        lock: botLock,
      }),
    );
    baseTx.outputsData.push("0x");

    vi.spyOn(ownedOwnerManager, "requestWithdrawal").mockImplementation(
      async (txLike) => {
        await Promise.resolve();
        const tx = ccc.Transaction.from(txLike);
        expect(tx.inputs).toHaveLength(1);
        expect(tx.outputs).toHaveLength(1);
        tx.inputs.push(
          ccc.CellInput.from({
            previousOutput: {
              txHash: hash("81"),
              index: 0n,
            },
          }),
        );
        tx.outputs.push(
          ccc.CellOutput.from({
            capacity: 2n,
            lock: botLock,
          }),
        );
        tx.outputsData.push("0x");
        return tx;
      },
    );
    vi.spyOn(orderManager, "melt").mockImplementation((txLike) => {
      const tx = ccc.Transaction.from(txLike);
      expect(tx.inputs).toHaveLength(2);
      expect(tx.outputs).toHaveLength(2);
      tx.inputs.push(
        ccc.CellInput.from({
          previousOutput: {
            txHash: hash("82"),
            index: 0n,
          },
        }),
      );
      return tx;
    });

    const tx = await sdk.buildBaseTransaction(baseTx, {} as ccc.Client, {
      withdrawalRequest: {
        deposits: [requestedDeposit],
        lock: botLock,
      },
      orders: [{} as OrderGroup],
    });

    expect(tx.inputs).toHaveLength(3);
    expect(tx.outputs).toHaveLength(2);
    expect(tx.outputsData).toEqual(["0x", "0x"]);
  });

  it("lets callers append a deposit after the withdrawal request path", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const daoManager = new DaoManager(dao, []);
    const logicManager = new LogicManager(logic, [], daoManager);
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], daoManager);
    const orderManager = new OrderManager(order, [], udt);
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      logicManager,
      orderManager,
      [botLock],
    );
    const calls: string[] = [];
    const requestedDeposit = depositCell("85", logic, dao, tip, tip, {
      isReady: true,
    });

    vi.spyOn(ownedOwnerManager, "requestWithdrawal").mockImplementation(
      async (txLike) => {
        await Promise.resolve();
        calls.push("request");
        const tx = ccc.Transaction.from(txLike);
        expect(tx.outputs).toHaveLength(0);
        tx.outputs.push(
          ccc.CellOutput.from({
            capacity: 1n,
            lock: botLock,
          }),
        );
        tx.outputsData.push("0x");
        return tx;
      },
    );
    vi.spyOn(logicManager, "deposit").mockImplementation(async (txLike) => {
      await Promise.resolve();
      calls.push("deposit");
      const tx = ccc.Transaction.from(txLike);
      expect(tx.outputs).toHaveLength(1);
      tx.outputs.push(
        ccc.CellOutput.from({
          capacity: 2n,
          lock: botLock,
        }),
      );
      tx.outputsData.push("0x");
      return tx;
    });

    let tx = await sdk.buildBaseTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      withdrawalRequest: {
        deposits: [requestedDeposit],
        lock: botLock,
      },
    });
    tx = await logicManager.deposit(tx, 1, 2n, botLock, {} as ccc.Client);

    expect(calls).toEqual(["request", "deposit"]);
    expect(tx.outputs).toHaveLength(2);
  });

  it("lets DAO withdrawal own unbalanced caller prework rejection", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, [])),
      new LogicManager(logic, [], new DaoManager(dao, [])),
      new OrderManager(order, [], udt),
      [botLock],
    );
    const tx = ccc.Transaction.default();
    tx.inputs.push(
      ccc.CellInput.from({
        previousOutput: {
          txHash: hash("84"),
          index: 0n,
        },
      }),
    );

    await expect(
      sdk.buildBaseTransaction(tx, {} as ccc.Client, {
        withdrawalRequest: {
          deposits: [depositCell("85", logic, dao, tip, tip, { isReady: true })],
          lock: botLock,
        },
      }),
    ).rejects.toThrow("Transaction has different inputs and outputs lengths");
  });
});

describe("IckbSdk.buildConversionTransaction", () => {
  it("plans CKB-to-iCKB direct deposits before fallback orders", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const calls: string[] = [];
    const remainder = ccc.fixedPointFrom(10000);
    const deposit = vi.spyOn(logicManager, "deposit").mockImplementation(
      async (txLike, quantity, depositCapacity, depositLock) => {
        await Promise.resolve();
        calls.push(`deposit:${String(quantity)}`);
        expect(depositCapacity).toBe(ICKB_DEPOSIT_CAP);
        expect(depositLock).toBe(lock);
        const tx = ccc.Transaction.from(txLike);
        tx.outputs.push(ccc.CellOutput.from({ capacity: 1n, lock }));
        tx.outputsData.push("0x");
        return tx;
      },
    );
    const mint = vi.spyOn(orderManager, "mint").mockImplementation((txLike, _lock, _info, amounts) => {
      calls.push("order");
      expect(amounts).toEqual({ ckbValue: remainder, udtValue: 0n });
      const tx = ccc.Transaction.from(txLike);
      expect(tx.outputs).toHaveLength(1);
      tx.outputs.push(ccc.CellOutput.from({ capacity: 2n, lock }));
      tx.outputsData.push("0x");
      return tx;
    });

    const result = await sdk.buildConversionTransaction(
      ccc.Transaction.default(),
      {} as ccc.Client,
      {
        direction: "ckb-to-ickb",
        amount: ICKB_DEPOSIT_CAP * 2n + remainder,
        lock,
        context: {
          system: system({ ckbAvailable: ICKB_DEPOSIT_CAP * 3n }),
          receipts: [],
          readyWithdrawals: [],
          availableOrders: [],
          ckbAvailable: ICKB_DEPOSIT_CAP * 2n + remainder,
          ickbAvailable: 0n,
          estimatedMaturity: 0n,
        },
      },
    );

    expect(result).toMatchObject({ ok: true, conversion: { kind: "direct-plus-order" } });
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["deposit:2", "order"]);
  });

  it("caps CKB-to-iCKB direct deposits", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const deposit = vi.spyOn(logicManager, "deposit").mockImplementation(
      async (txLike, quantity) => {
        await Promise.resolve();
        expect(quantity).toBe(MAX_DIRECT_DEPOSITS);
        return ccc.Transaction.from(txLike);
      },
    );
    vi.spyOn(orderManager, "mint").mockImplementation((txLike) => ccc.Transaction.from(txLike));

    await sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ckb-to-ickb",
      amount: ICKB_DEPOSIT_CAP * BigInt(MAX_DIRECT_DEPOSITS + 1),
      lock,
      context: {
        system: system({ ckbAvailable: ICKB_DEPOSIT_CAP }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: ICKB_DEPOSIT_CAP * BigInt(MAX_DIRECT_DEPOSITS + 1),
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
    });

    expect(deposit).toHaveBeenCalledTimes(1);
  });

  it("retries CKB-to-iCKB direct deposits after DAO output-limit failures", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const deposit = vi.spyOn(logicManager, "deposit")
      .mockRejectedValueOnce(new DaoOutputLimitError(65))
      .mockImplementation(async (txLike, quantity) => {
        await Promise.resolve();
        expect(quantity).toBe(1);
        return ccc.Transaction.from(txLike);
      });
    vi.spyOn(orderManager, "mint").mockImplementation((txLike) => ccc.Transaction.from(txLike));

    await expect(sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ckb-to-ickb",
      amount: ICKB_DEPOSIT_CAP * 2n,
      lock,
      context: {
        system: system({ ckbAvailable: ICKB_DEPOSIT_CAP * 2n }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: ICKB_DEPOSIT_CAP * 2n,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
    })).resolves.toMatchObject({ ok: true, conversion: { kind: "direct-plus-order" } });

    expect(deposit).toHaveBeenCalledTimes(2);
  });

  it("skips predictably oversized CKB-to-iCKB candidates before building", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const quantities: number[] = [];
    const deposit = vi.spyOn(logicManager, "deposit").mockImplementation(
      async (txLike, quantity) => {
        await Promise.resolve();
        quantities.push(quantity);
        return ccc.Transaction.from(txLike);
      },
    );
    vi.spyOn(orderManager, "mint").mockImplementation((txLike) => ccc.Transaction.from(txLike));

    await expect(sdk.buildConversionTransaction(transactionWithOutputs(60, lock), {} as ccc.Client, {
      direction: "ckb-to-ickb",
      amount: ICKB_DEPOSIT_CAP * 2n + 1n,
      lock,
      context: {
        system: system({ ckbAvailable: ICKB_DEPOSIT_CAP * 3n }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: ICKB_DEPOSIT_CAP * 2n + 1n,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
    })).resolves.toMatchObject({ ok: true, conversion: { kind: "direct-plus-order" } });

    expect(deposit).toHaveBeenCalledTimes(1);
    expect(quantities).toEqual([1]);
  });

  it("recognizes DAO output-limit errors across package runtime boundaries", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const outputLimitError = new Error("same domain error from another package copy");
    outputLimitError.name = "DaoOutputLimitError";
    const deposit = vi.spyOn(logicManager, "deposit")
      .mockRejectedValueOnce(outputLimitError)
      .mockImplementation(async (txLike, quantity) => {
        await Promise.resolve();
        expect(quantity).toBe(1);
        return ccc.Transaction.from(txLike);
      });
    vi.spyOn(orderManager, "mint").mockImplementation((txLike) => ccc.Transaction.from(txLike));

    await expect(sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ckb-to-ickb",
      amount: ICKB_DEPOSIT_CAP * 2n,
      lock,
      context: {
        system: system({ ckbAvailable: ICKB_DEPOSIT_CAP * 2n }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: ICKB_DEPOSIT_CAP * 2n,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
    })).resolves.toMatchObject({ ok: true, conversion: { kind: "direct-plus-order" } });

    expect(deposit).toHaveBeenCalledTimes(2);
  });

  it("fails fast on non-retryable CKB-to-iCKB construction errors", async () => {
    const { sdk, logicManager, lock } = testSdk();
    const deposit = vi.spyOn(logicManager, "deposit")
      .mockRejectedValue(new Error("RPC failed"));

    await expect(sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ckb-to-ickb",
      amount: ICKB_DEPOSIT_CAP * 2n,
      lock,
      context: {
        system: system({ ckbAvailable: ICKB_DEPOSIT_CAP * 2n }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: ICKB_DEPOSIT_CAP * 2n,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
    })).rejects.toThrow("RPC failed");

    expect(deposit).toHaveBeenCalledTimes(1);
  });

  it("plans exact ready withdrawals with required anchors", async () => {
    const { sdk, ownedOwnerManager, lock } = testSdk();
    const extra = readyDeposit(10n, 0n);
    const protectedAnchor = readyDeposit(12n, 1n);
    const requestWithdrawal = vi.spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(async (txLike, deposits, requestLock, _client, requestOptions) => {
        await Promise.resolve();
        expect(deposits).toEqual([extra]);
        expect(requestLock).toBe(lock);
        expect(requestOptions).toEqual({ requiredLiveDeposits: [protectedAnchor] });
        return ccc.Transaction.from(txLike);
      });

    const result = await sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ickb-to-ckb",
      amount: 10n,
      lock,
      context: {
        system: system({
          poolDeposits: {
            deposits: [extra, protectedAnchor],
            readyDeposits: [extra, protectedAnchor],
            id: "pool",
          },
        }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: 10n,
        estimatedMaturity: 0n,
      },
    });

    expect(result).toMatchObject({ ok: true, conversion: { kind: "direct" } });
    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
  });

  it("builds iCKB-to-CKB direct withdrawals plus dust remainder orders", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const directDeposit = readyDeposit(ICKB_DEPOSIT_CAP);
    const requestWithdrawal = vi.spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(async (txLike, deposits) => {
        await Promise.resolve();
        expect(deposits).toEqual([directDeposit]);
        return ccc.Transaction.from(txLike);
      });
    const mint = vi.spyOn(orderManager, "mint").mockImplementation((txLike, _lock, info, amounts) => {
      expect(info.ckbMinMatchLog).toBe(33);
      expect(amounts).toEqual({ ckbValue: 0n, udtValue: 100000n });
      return ccc.Transaction.from(txLike);
    });
    const exchangeRatio = Ratio.from({
      ckbScale: 10000000000000000n,
      udtScale: 10008200000000000n,
    });
    const amount = ICKB_DEPOSIT_CAP + 100000n;

    const result = await sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ickb-to-ckb",
      amount,
      lock,
      context: {
        system: system({
          exchangeRatio,
          ckbAvailable: convert(false, ICKB_DEPOSIT_CAP, exchangeRatio),
          poolDeposits: {
            deposits: [directDeposit],
            readyDeposits: [directDeposit],
            id: "pool",
          },
        }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: amount,
        estimatedMaturity: 0n,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      conversion: { kind: "direct-plus-order" },
      conversionNotice: {
        kind: "dust-ickb-to-ckb",
        inputIckb: 100000n,
        outputCkb: 100072n,
        incentiveCkb: 10n,
        maturityEstimateUnavailable: false,
      },
    });
    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("prefers better direct iCKB-to-CKB economic surplus within a maturity bucket", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const unit = ICKB_DEPOSIT_CAP / 10n;
    const largerLowerGain = readyDeposit(9n * unit, 0n, {
      ckbValue: 9n * unit,
      id: "a1",
    });
    const smallerHigherGain = readyDeposit(8n * unit, 30n * 60n * 1000n, {
      ckbValue: 8n * unit + 1000n,
      id: "a2",
    });
    const requestWithdrawal = vi.spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(async (txLike, deposits) => {
        await Promise.resolve();
        expect(deposits).toEqual([smallerHigherGain]);
        return ccc.Transaction.from(txLike);
    });
    const mint = vi.spyOn(orderManager, "mint").mockImplementation((txLike, _lock, _info, amounts) => {
      expect(amounts).toEqual({ ckbValue: 0n, udtValue: 2n * unit });
      return ccc.Transaction.from(txLike);
    });

    await expect(sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ickb-to-ckb",
      amount: ICKB_DEPOSIT_CAP,
      lock,
      context: {
        system: system({
          exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
          ckbAvailable: 10n,
          poolDeposits: {
            deposits: [largerLowerGain, smallerHigherGain],
            readyDeposits: [largerLowerGain, smallerHigherGain],
            id: "pool",
          },
        }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: ICKB_DEPOSIT_CAP,
        estimatedMaturity: 0n,
      },
    })).resolves.toMatchObject({ ok: true, conversion: { kind: "direct-plus-order" } });

    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("prefers an earlier iCKB-to-CKB maturity bucket over a marginally larger withdrawal", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const unit = ICKB_DEPOSIT_CAP / 10n;
    const smallEarlier = readyDeposit(4n * unit, 0n);
    const smallLater = readyDeposit(4n * unit, 15n * 60n * 1000n);
    const largeMuchLater = readyDeposit(9n * unit, 2n * 60n * 60n * 1000n);
    const requestWithdrawal = vi.spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(async (txLike, deposits) => {
        await Promise.resolve();
        expect(deposits).toEqual([smallEarlier, smallLater]);
        return ccc.Transaction.from(txLike);
      });
    const mint = vi.spyOn(orderManager, "mint").mockImplementation((txLike, _lock, _info, amounts) => {
      expect(amounts).toEqual({ ckbValue: 0n, udtValue: 2n * unit });
      return ccc.Transaction.from(txLike);
    });

    await expect(sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ickb-to-ckb",
      amount: ICKB_DEPOSIT_CAP,
      lock,
      context: {
        system: system({
          exchangeRatio: Ratio.from({ ckbScale: 100n, udtScale: 1n }),
          ckbAvailable: 10n,
          poolDeposits: {
            deposits: [smallEarlier, smallLater, largeMuchLater],
            readyDeposits: [smallEarlier, smallLater, largeMuchLater],
            id: "pool",
          },
        }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: ICKB_DEPOSIT_CAP,
        estimatedMaturity: 0n,
      },
    })).resolves.toMatchObject({ ok: true, conversion: { kind: "direct-plus-order" } });

    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("preserves iCKB-to-CKB maturity-bucket priority before direct surplus", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const unit = ICKB_DEPOSIT_CAP / 10n;
    const earlier = readyDeposit(8n * unit, 30n * 60n * 1000n, {
      ckbValue: 8n * unit,
      id: "b1",
    });
    const laterHigherGain = readyDeposit(8n * unit, 2n * 60n * 60n * 1000n, {
      ckbValue: 8n * unit + 1000n,
      id: "b2",
    });
    const requestWithdrawal = vi.spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(async (txLike, deposits) => {
        await Promise.resolve();
        expect(deposits).toEqual([earlier]);
        return ccc.Transaction.from(txLike);
      });
    const mint = vi.spyOn(orderManager, "mint").mockImplementation((txLike) =>
      ccc.Transaction.from(txLike)
    );

    await expect(sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ickb-to-ckb",
      amount: ICKB_DEPOSIT_CAP,
      lock,
      context: {
        system: system({
          exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
          ckbAvailable: 10n,
          poolDeposits: {
            deposits: [laterHigherGain, earlier],
            readyDeposits: [laterHigherGain, earlier],
            id: "pool",
          },
        }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: ICKB_DEPOSIT_CAP,
        estimatedMaturity: 0n,
      },
    })).resolves.toMatchObject({ ok: true, conversion: { kind: "direct-plus-order" } });

    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("skips iCKB-to-CKB deposits above the requested amount even with high surplus", async () => {
    const { sdk, ownedOwnerManager, lock } = testSdk();
    const oversized = readyDeposit(ICKB_DEPOSIT_CAP + 1n, 0n, {
      ckbValue: ICKB_DEPOSIT_CAP * 2n,
      id: "c1",
    });
    const fitting = readyDeposit(ICKB_DEPOSIT_CAP, 15n * 60n * 1000n, {
      ckbValue: ICKB_DEPOSIT_CAP,
      id: "c2",
    });
    const requestWithdrawal = vi.spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(async (txLike, deposits) => {
        await Promise.resolve();
        expect(deposits).toEqual([fitting]);
        return ccc.Transaction.from(txLike);
      });

    await expect(sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ickb-to-ckb",
      amount: ICKB_DEPOSIT_CAP,
      lock,
      context: {
        system: system({
          exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
          poolDeposits: {
            deposits: [oversized, fitting],
            readyDeposits: [oversized, fitting],
            id: "pool",
          },
        }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: ICKB_DEPOSIT_CAP,
        estimatedMaturity: 0n,
      },
    })).resolves.toMatchObject({ ok: true, conversion: { kind: "direct" } });

    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
  });

  it("returns typed failures for no activity and tiny orders", async () => {
    const { sdk, lock } = testSdk();

    await expect(sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ckb-to-ickb",
      amount: 0n,
      lock,
      context: {
        system: system(),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
    })).resolves.toEqual({ ok: false, reason: "nothing-to-do", estimatedMaturity: 0n });

    await expect(sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ckb-to-ickb",
      amount: 1n,
      lock,
      context: {
        system: system(),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: 1n,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
    })).resolves.toEqual({ ok: false, reason: "amount-too-small", estimatedMaturity: 0n });
  });

  it("fails fast on non-retryable iCKB-to-CKB construction errors", async () => {
    const { sdk, ownedOwnerManager, lock } = testSdk();
    const extra = readyDeposit(1n, 0n);
    const protectedAnchor = readyDeposit(2n, 1n);
    vi.spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockRejectedValue(new Error("withdrawal failed"));

    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({
      previousOutput: { txHash: hash("90"), index: 0n },
    }));
    tx.outputs.push(ccc.CellOutput.from({ capacity: 1n, lock }));
    tx.outputsData.push("0x");

    await expect(sdk.buildConversionTransaction(tx, {} as ccc.Client, {
      direction: "ickb-to-ckb",
      amount: 1n,
      lock,
      context: {
        system: system({
          exchangeRatio: Ratio.from({ ckbScale: 100n, udtScale: 1n }),
          poolDeposits: {
            deposits: [extra, protectedAnchor],
            readyDeposits: [extra, protectedAnchor],
            id: "pool",
          },
        }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: 1n,
        estimatedMaturity: 0n,
      },
    })).rejects.toThrow("withdrawal failed");
  });

  it("retries iCKB-to-CKB withdrawals after DAO output-limit failures", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const first = readyDeposit(ICKB_DEPOSIT_CAP / 2n, 0n);
    const second = readyDeposit(ICKB_DEPOSIT_CAP / 2n, 15n * 60n * 1000n);
    const requestedCounts: number[] = [];
    const requestWithdrawal = vi.spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(async (txLike, deposits) => {
        await Promise.resolve();
        requestedCounts.push(deposits.length);
        if (requestedCounts.length === 1) {
          throw new DaoOutputLimitError(65);
        }
        expect(deposits).toHaveLength(1);
        return ccc.Transaction.from(txLike);
      });
    vi.spyOn(orderManager, "mint").mockImplementation((txLike) => ccc.Transaction.from(txLike));

    await expect(sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ickb-to-ckb",
      amount: ICKB_DEPOSIT_CAP,
      lock,
      context: {
        system: system({
          poolDeposits: {
            deposits: [first, second],
            readyDeposits: [first, second],
            id: "pool",
          },
        }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: ICKB_DEPOSIT_CAP,
        estimatedMaturity: 0n,
      },
    })).resolves.toMatchObject({ ok: true, conversion: { kind: "direct-plus-order" } });

    expect(requestWithdrawal).toHaveBeenCalledTimes(2);
    expect(requestedCounts).toEqual([2, 1]);
  });

  it("skips predictably oversized iCKB-to-CKB candidates before building", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const first = readyDeposit(ICKB_DEPOSIT_CAP / 2n, 0n);
    const second = readyDeposit(ICKB_DEPOSIT_CAP / 2n, 15n * 60n * 1000n);
    const requestedCounts: number[] = [];
    const requestWithdrawal = vi.spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(async (txLike, deposits) => {
        await Promise.resolve();
        requestedCounts.push(deposits.length);
        return ccc.Transaction.from(txLike);
      });
    vi.spyOn(orderManager, "mint").mockImplementation((txLike) => ccc.Transaction.from(txLike));

    await expect(sdk.buildConversionTransaction(transactionWithOutputs(60, lock), {} as ccc.Client, {
      direction: "ickb-to-ckb",
      amount: ICKB_DEPOSIT_CAP + 1n,
      lock,
      context: {
        system: system({
          poolDeposits: {
            deposits: [first, second],
            readyDeposits: [first, second],
            id: "pool",
          },
        }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: ICKB_DEPOSIT_CAP + 1n,
        estimatedMaturity: 0n,
      },
    })).resolves.toMatchObject({ ok: true, conversion: { kind: "direct-plus-order" } });

    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
    expect(requestedCounts).toEqual([1]);
  });

  it("reports predictable DAO output-limit exhaustion", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const deposit = vi.spyOn(logicManager, "deposit").mockImplementation(
      async (txLike) => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      },
    );
    const mint = vi.spyOn(orderManager, "mint").mockImplementation((txLike) => ccc.Transaction.from(txLike));

    await expect(sdk.buildConversionTransaction(transactionWithOutputs(64, lock), {} as ccc.Client, {
      direction: "ckb-to-ickb",
      amount: ICKB_DEPOSIT_CAP,
      lock,
      context: {
        system: system({ ckbAvailable: ICKB_DEPOSIT_CAP }),
        receipts: [],
        readyWithdrawals: [{} as WithdrawalGroup],
        availableOrders: [],
        ckbAvailable: ICKB_DEPOSIT_CAP,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
    })).rejects.toThrow(DaoOutputLimitError);

    expect(deposit).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
  });

  it("does not count input-only base activities as planned DAO outputs", async () => {
    const { sdk, logicManager, ownedOwnerManager, orderManager, lock } = testSdk();
    vi.spyOn(orderManager, "melt").mockImplementation((txLike) => {
      const tx = ccc.Transaction.from(txLike);
      tx.inputs.push(ccc.CellInput.from({ previousOutput: { txHash: hash("c1"), index: 0n } }));
      return tx;
    });
    vi.spyOn(logicManager, "completeDeposit").mockImplementation((txLike) => {
      const tx = ccc.Transaction.from(txLike);
      tx.inputs.push(ccc.CellInput.from({ previousOutput: { txHash: hash("c2"), index: 0n } }));
      return tx;
    });
    vi.spyOn(ownedOwnerManager, "withdraw").mockImplementation(async (txLike) => {
      await Promise.resolve();
      const tx = ccc.Transaction.from(txLike);
      tx.inputs.push(ccc.CellInput.from({ previousOutput: { txHash: hash("c3"), index: 0n } }));
      return tx;
    });
    const deposit = vi.spyOn(logicManager, "deposit").mockImplementation(
      async (txLike) => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      },
    );
    const mint = vi.spyOn(orderManager, "mint").mockImplementation((txLike) => ccc.Transaction.from(txLike));

    await expect(sdk.buildConversionTransaction(transactionWithOutputs(62, lock), {} as ccc.Client, {
      direction: "ckb-to-ickb",
      amount: ICKB_DEPOSIT_CAP,
      lock,
      context: {
        system: system({ ckbAvailable: ICKB_DEPOSIT_CAP }),
        receipts: [{} as ReceiptCell],
        readyWithdrawals: [{} as WithdrawalGroup],
        availableOrders: [{} as OrderGroup],
        ckbAvailable: ICKB_DEPOSIT_CAP,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
    })).resolves.toMatchObject({ ok: true, conversion: { kind: "direct" } });

    expect(deposit).toHaveBeenCalledTimes(1);
    expect(mint).not.toHaveBeenCalled();
  });

  it("preserves retryable construction errors when retries exhaust into planning misses", async () => {
    const { sdk, logicManager, lock } = testSdk();
    vi.spyOn(logicManager, "deposit").mockRejectedValue(new DaoOutputLimitError(65));

    await expect(sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ckb-to-ickb",
      amount: ICKB_DEPOSIT_CAP,
      lock,
      context: {
        system: system({
          ckbAvailable: ICKB_DEPOSIT_CAP,
          feeRate: ccc.fixedPointFrom(1),
        }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: ICKB_DEPOSIT_CAP,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
    })).rejects.toBeInstanceOf(DaoOutputLimitError);
  });

  it("uses plain-object error messages in conversion construction failures", async () => {
    const { sdk, logicManager, lock } = testSdk();
    vi.spyOn(logicManager, "deposit").mockRejectedValue({ message: "RPC failed" });

    await expect(sdk.buildConversionTransaction(ccc.Transaction.default(), {} as ccc.Client, {
      direction: "ckb-to-ickb",
      amount: ICKB_DEPOSIT_CAP,
      lock,
      context: {
        system: system({ ckbAvailable: ICKB_DEPOSIT_CAP }),
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: ICKB_DEPOSIT_CAP,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
    })).rejects.toThrow("RPC failed");
  });
});

describe("completeIckbTransaction", () => {
  it("runs UDT, fee, DAO-limit in order", async () => {
    const calls: string[] = [];
    const signer = {} as ccc.Signer;
    const client = {} as ccc.Client;
    const tx = ccc.Transaction.default();
    const ickbUdt = fakeIckbUdt();
    vi.spyOn(ickbUdt, "completeBy").mockImplementation(async (txLike) => {
      calls.push("udt");
      await Promise.resolve();
      return ccc.Transaction.from(txLike);
    });
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockImplementation(() => {
      calls.push("fee");
      return Promise.resolve([0, false]);
    });
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockImplementation(() => {
      calls.push("dao-limit");
      return Promise.resolve(false);
    });

    const completed = await completeIckbTransaction(tx, ickbUdt, {
      signer,
      client,
      feeRate: 42n,
    });

    expect(completed).toBeInstanceOf(ccc.Transaction);
    expect(calls).toEqual(["udt", "fee", "dao-limit"]);
  });

  it("uses the provided fee rate", async () => {
    const signer = {} as ccc.Signer;
    const client = {} as ccc.Client;
    const completeFeeBy = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeBy")
      .mockResolvedValue([0, false]);
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);

    await completeIckbTransaction(ccc.Transaction.default(), fakeIckbUdt(), {
      signer,
      client,
      feeRate: 123n,
    });

    expect(completeFeeBy).toHaveBeenCalledWith(signer, 123n);
  });

});

describe("sendAndWaitForCommit", () => {
  it("waits for a sent transaction to commit before returning the hash", async () => {
    const txHash = hash("a1");
    const sleep = vi.fn(() => Promise.resolve());
    const onConfirmationWait = vi.fn();
    const sendTransaction = vi.fn().mockResolvedValue(txHash);
    const getTransaction = vi
      .fn()
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "unknown" })
      .mockResolvedValueOnce({ status: "committed" });

    await expect(sendAndWaitForCommit(
      {
        client: { getTransaction } as unknown as ccc.Client,
        signer: { sendTransaction } as unknown as ccc.Signer,
      },
      ccc.Transaction.default(),
      {
        confirmationIntervalMs: 7,
        onConfirmationWait,
        sleep,
      },
    )).resolves.toBe(txHash);

    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(onConfirmationWait).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(7);
    expect(getTransaction).toHaveBeenCalledTimes(3);
    expect(getTransaction).toHaveBeenCalledWith(txHash);
  });

  it("surfaces terminal transaction failures", async () => {
    const txHash = hash("a2");
    const sleep = vi.fn(() => Promise.resolve());

    try {
      await sendAndWaitForCommit(
        {
          client: {
            getTransaction: vi.fn().mockResolvedValue({ status: "rejected" }),
          } as unknown as ccc.Client,
          signer: {
            sendTransaction: vi.fn().mockResolvedValue(txHash),
          } as unknown as ccc.Signer,
        },
        ccc.Transaction.default(),
        { sleep },
      );
      expect.fail("Expected sendAndWaitForCommit to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(TransactionConfirmationError);
      expect(error).toMatchObject({
        message: "Transaction ended with status: rejected",
        txHash,
        status: "rejected",
        isTimeout: false,
      });
    }

    expect(sleep).not.toHaveBeenCalled();
  });

  it("surfaces transaction confirmation timeouts with the broadcast hash", async () => {
    const txHash = hash("a3");
    const onSent = vi.fn();

    try {
      await sendAndWaitForCommit(
        {
          client: {
            getTransaction: vi.fn().mockResolvedValue({ status: "unknown" }),
          } as unknown as ccc.Client,
          signer: {
            sendTransaction: vi.fn().mockResolvedValue(txHash),
          } as unknown as ccc.Signer,
        },
        ccc.Transaction.default(),
        {
          maxConfirmationChecks: 1,
          onSent,
          sleep: () => Promise.resolve(),
        },
      );
      expect.fail("Expected sendAndWaitForCommit to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(TransactionConfirmationError);
      expect(error).toMatchObject({
        message: "Transaction confirmation timed out",
        txHash,
        status: "unknown",
        isTimeout: true,
      });
    }

    expect(onSent).toHaveBeenCalledWith(txHash);
  });

  it("treats post-broadcast polling failures as unconfirmed", async () => {
    const txHash = hash("a4");
    const onSent = vi.fn();
    const onConfirmationWait = vi.fn();
    const sleep = vi.fn(() => Promise.resolve());
    const getTransaction = vi
      .fn()
      .mockRejectedValueOnce(new Error("RPC down"))
      .mockResolvedValueOnce({ status: "committed" });

    await expect(sendAndWaitForCommit(
      {
        client: { getTransaction } as unknown as ccc.Client,
        signer: {
          sendTransaction: vi.fn().mockResolvedValue(txHash),
        } as unknown as ccc.Signer,
      },
      ccc.Transaction.default(),
      {
        onConfirmationWait,
        onSent,
        sleep,
      },
    )).resolves.toBe(txHash);

    expect(onSent).toHaveBeenCalledWith(txHash);
    expect(onConfirmationWait).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("times out if post-broadcast polling keeps failing", async () => {
    const txHash = hash("a5");
    const pollingError = new Error("RPC down");

    try {
      await sendAndWaitForCommit(
        {
          client: {
            getTransaction: vi.fn().mockRejectedValue(pollingError),
          } as unknown as ccc.Client,
          signer: {
            sendTransaction: vi.fn().mockResolvedValue(txHash),
          } as unknown as ccc.Signer,
        },
        ccc.Transaction.default(),
        {
          maxConfirmationChecks: 1,
          sleep: () => Promise.resolve(),
        },
      );
      expect.fail("Expected sendAndWaitForCommit to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(TransactionConfirmationError);
      expect(error).toMatchObject({
        message: "Transaction confirmation timed out",
        txHash,
        status: "sent",
        isTimeout: true,
      });
      expect(error).toHaveProperty("cause", pollingError);
    }
  });
});

describe("IckbSdk.getL1State snapshot detection", () => {
  it("does not classify user-owned matchable orders as system liquidity", async () => {
    const userLock = script("11");
    const nonUserLock = script("12");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const orderScript = script("55");
    const udt = script("66");
    const orderManager = new OrderManager(orderScript, [], udt);
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, [])),
      new LogicManager(logic, [], new DaoManager(dao, [])),
      orderManager,
      [],
    );
    const ownerOrder = makeOrderGroup({
      orderScript,
      udtScript: udt,
      ownerLock: userLock,
      txHashByte: "a1",
    });
    ownerOrder.group.order.maturity = 999n;
    const marketOrder = makeOrderGroup({
      orderScript,
      udtScript: udt,
      ownerLock: nonUserLock,
      txHashByte: "a2",
      orderTxHashByte: "a3",
      ratio: { ckbScale: 2n, udtScale: 1n },
      orderCapacity: ccc.fixedPointFrom(300),
      udtValue: 1n,
    });
    vi.spyOn(orderManager, "findOrders").mockImplementation(async function* () {
      yield ownerOrder.group;
      yield marketOrder.group;
      await Promise.resolve();
    });

    const client = {
      getTipHeader: () => Promise.resolve(headerLike(1n)),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: () => none(),
    } as unknown as ccc.Client;

    const state = await sdk.getL1State(client, [userLock]);

    expect(state.user.orders).toHaveLength(1);
    expect(state.user.orders[0]).not.toBe(ownerOrder.group);
    expect(state.user.orders[0]?.master).toBe(ownerOrder.group.master);
    expect(state.user.orders[0]?.origin).toBe(ownerOrder.group.origin);
    expect(state.user.orders[0]?.order).not.toBe(ownerOrder.group.order);
    expect(state.user.orders[0]?.order.maturity).toBe(0n);
    expect(ownerOrder.group.order.maturity).toBe(999n);
    expect(state.system.orderPool).toEqual([marketOrder.group.order]);
  });

  it("ignores bot data cells and falls back to direct deposit scanning", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, [])),
      new LogicManager(logic, [], new DaoManager(dao, [])),
      new OrderManager(order, [], udt),
      [botLock],
    );
    const fakeAlignedData = ccc.hexFrom(new Uint8Array(128).fill(0xaa));
    const header = headerLike(1n);
    const botCells = [
      ccc.Cell.from({
        outPoint: { txHash: hash("01"), index: 0n },
        cellOutput: { capacity: 1000n, lock: botLock },
        outputData: fakeAlignedData,
      }),
    ];
    const depositCell = ccc.Cell.from({
      outPoint: { txHash: hash("02"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: logic,
        type: dao,
      },
      outputData: DaoManager.depositData(),
    });
    const client = {
      getTipHeader: () => Promise.resolve(header),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: async function* (query: {
        scriptType?: string;
        filter?: { outputData?: ccc.Hex };
      }) {
        if (query.filter?.outputData === DaoManager.depositData()) {
          yield depositCell;
        }
        if (query.scriptType === "lock") {
          for (const cell of botCells) {
            yield cell;
          }
        }
        await Promise.resolve();
      },
      getTransactionWithHeader: (txHash: ccc.Hex) => Promise.resolve({
        header: txHash === hash("02")
          ? headerLike(0n)
          : headerLike(1n, { epoch: ccc.Epoch.from([2n, 0n, 1n]) }),
      }),
    } as unknown as ccc.Client;

    const state = await sdk.getL1State(client, []);

    expect(state.user.orders).toEqual([]);
    expect(state.system.ckbMaturing).toHaveLength(1);
    expect(state.system.ckbMaturing[0]?.ckbCumulative).toBe(
      ccc.fixedPointFrom(100082),
    );
  });

  it("treats ready deposits as available CKB instead of future maturity", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const daoManager = new DaoManager(dao, []);
    const logicManager = new LogicManager(logic, [], daoManager);
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], daoManager);
    const readyDeposit = {
      cell: ccc.Cell.from({
        outPoint: { txHash: hash("03"), index: 0n },
        cellOutput: {
          capacity: ccc.fixedPointFrom(100082),
          lock: logic,
          type: dao,
        },
        outputData: DaoManager.depositData(),
      }),
      isDeposit: true,
      headers: [{ header: headerLike(0n) }, { header: headerLike(0n) }],
      interests: 0n,
      maturity: ccc.Epoch.from([1n, 0n, 1n]),
      isReady: true,
      ckbValue: ccc.fixedPointFrom(100082),
      udtValue: ccc.fixedPointFrom(100000),
    } as IckbDepositCell;
    const findDeposits = vi.spyOn(logicManager, "findDeposits").mockImplementation(() => once(readyDeposit));
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      logicManager,
      new OrderManager(order, [], udt),
      [botLock],
    );
    const tip = headerLike(1n, { epoch: ccc.Epoch.from([181n, 0n, 1n]) });
    const client = {
      getTipHeader: () => Promise.resolve(tip),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: () => none(),
      getTransactionWithHeader: () => Promise.resolve({ header: headerLike(0n) }),
    } as unknown as ccc.Client;

    const state = await sdk.getL1State(client, []);

    expect(findDeposits).toHaveBeenCalled();
    expect(state.system.ckbAvailable).toBe(ccc.fixedPointFrom(100082));
    expect(state.system.ckbMaturing).toEqual([]);
  });

  it("allows bot capacity scanning to exactly reach the limit", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, []));
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      new LogicManager(logic, [], new DaoManager(dao, [])),
      new OrderManager(order, [], udt),
      [botLock],
    );
    const plainCell = ccc.Cell.from({
      outPoint: { txHash: hash("04"), index: 0n },
      cellOutput: { capacity: 1n, lock: botLock },
      outputData: "0x",
    });
    const client = {
      getTipHeader: () => Promise.resolve(headerLike(1n)),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: async function* (query: { filter?: { scriptLenRange?: unknown } }) {
        if (query.filter?.scriptLenRange) {
          yield* repeat(defaultFindCellsLimit, plainCell);
        }
        await Promise.resolve();
      },
    } as unknown as ccc.Client;

    await expect(sdk.getL1State(client, [])).resolves.toBeDefined();
  });

  it("fails closed when bot capacity scanning exceeds the limit", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, []));
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      new LogicManager(logic, [], new DaoManager(dao, [])),
      new OrderManager(order, [], udt),
      [botLock],
    );
    const plainCell = ccc.Cell.from({
      outPoint: { txHash: hash("04"), index: 0n },
      cellOutput: { capacity: 1n, lock: botLock },
      outputData: "0x",
    });
    const client = {
      getTipHeader: () => Promise.resolve(headerLike(1n)),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: async function* (query: { filter?: { scriptLenRange?: unknown } }) {
        if (query.filter?.scriptLenRange) {
          yield* repeat(defaultFindCellsLimit + 1, plainCell);
        }
        await Promise.resolve();
      },
    } as unknown as ccc.Client;

    await expect(sdk.getL1State(client, [])).rejects.toThrow(
      `bot capacity scan reached limit ${String(defaultFindCellsLimit)}`,
    );
  });

  it("does not start bot withdrawal scanning when bot capacity scanning fails", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, []));
    const findWithdrawalGroups = vi.spyOn(ownedOwnerManager, "findWithdrawalGroups")
      .mockImplementation(() => none());
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      new LogicManager(logic, [], new DaoManager(dao, [])),
      new OrderManager(order, [], udt),
      [botLock],
    );
    const plainCell = ccc.Cell.from({
      outPoint: { txHash: hash("04"), index: 0n },
      cellOutput: { capacity: 1n, lock: botLock },
      outputData: "0x",
    });
    const client = {
      getTipHeader: () => Promise.resolve(headerLike(1n)),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: async function* (query: { filter?: { scriptLenRange?: unknown } }) {
        if (query.filter?.scriptLenRange) {
          yield* repeat(defaultFindCellsLimit + 1, plainCell);
        }
        await Promise.resolve();
      },
    } as unknown as ccc.Client;

    await expect(sdk.getL1State(client, [])).rejects.toThrow(
      `bot capacity scan reached limit ${String(defaultFindCellsLimit)}`,
    );
    expect(findWithdrawalGroups).not.toHaveBeenCalled();
  });

  it("propagates bot withdrawal scan failures after bot capacity scanning succeeds", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, []));
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(async function* () {
      await Promise.resolve();
      yield* [] as WithdrawalGroup[];
      throw new Error("withdrawal failed");
    });
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      new LogicManager(logic, [], new DaoManager(dao, [])),
      new OrderManager(order, [], udt),
      [botLock],
    );
    const client = {
      getTipHeader: () => Promise.resolve(headerLike(1n)),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: () => none(),
    } as unknown as ccc.Client;

    await expect(sdk.getL1State(client, [])).rejects.toThrow("withdrawal failed");
  });

  it("allows direct deposit scanning to exactly reach the limit", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const logicManager = new LogicManager(logic, [], new DaoManager(dao, []));
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, []));
    const deposit = {
      cell: ccc.Cell.from({
        outPoint: { txHash: hash("03"), index: 0n },
        cellOutput: { capacity: 1n, lock: logic, type: dao },
        outputData: DaoManager.depositData(),
      }),
      isReady: false,
      ckbValue: 1n,
      udtValue: 1n,
      maturity: { toUnix: () => 1n },
    } as unknown as IckbDepositCell;
    vi.spyOn(logicManager, "findDeposits").mockImplementation(() =>
      repeat(defaultFindCellsLimit, deposit)
    );
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      logicManager,
      new OrderManager(order, [], udt),
      [botLock],
    );
    const client = {
      getTipHeader: () => Promise.resolve(headerLike(1n)),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: () => none(),
    } as unknown as ccc.Client;

    await expect(sdk.getL1State(client, [])).resolves.toBeDefined();
  });

  it("fails closed when direct deposit scanning exceeds the limit", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const daoManager = new DaoManager(dao, []);
    const logicManager = new LogicManager(logic, [], daoManager);
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, []));
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      logicManager,
      new OrderManager(order, [], udt),
      [botLock],
    );
    const deposit = ccc.Cell.from({
      outPoint: { txHash: hash("03"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: logic,
        type: dao,
      },
      outputData: DaoManager.depositData(),
    });
    const client = {
      getTipHeader: () => Promise.resolve(headerLike(1n)),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: async function* (query: { filter?: { outputData?: ccc.Hex } }) {
        if (query.filter?.outputData === DaoManager.depositData()) {
          yield* repeat(defaultFindCellsLimit + 1, deposit);
        }
        await Promise.resolve();
      },
    } as unknown as ccc.Client;

    await expect(sdk.getL1State(client, [])).rejects.toThrow(
      `DAO deposit cell scan reached limit ${String(defaultFindCellsLimit)}`,
    );
  });

  it("passes the logical limit to direct deposit scanning", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const logicManager = new LogicManager(logic, [], new DaoManager(dao, []));
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, []));
    const findDeposits = vi.spyOn(logicManager, "findDeposits").mockImplementation(() => none());
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      logicManager,
      new OrderManager(order, [], udt),
      [botLock],
    );
    const client = {
      getTipHeader: () => Promise.resolve(headerLike(1n)),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: () => none(),
    } as unknown as ccc.Client;

    await sdk.getL1State(client, []);

    expect(findDeposits.mock.calls[0]?.[1]).toMatchObject({
      limit: defaultFindCellsLimit,
    });
  });

  it("passes a custom logical limit to pool deposit scanning", async () => {
    const { sdk, logicManager } = testSdk();
    const findDeposits = vi.spyOn(logicManager, "findDeposits").mockImplementation(() => none());
    const client = {
      findCellsOnChain: () => none(),
    } as unknown as ccc.Client;
    const poolLimit = defaultFindCellsLimit + 100;

    await sdk.getPoolDeposits(client, tip, { limit: poolLimit });

    expect(findDeposits.mock.calls[0]?.[1]).toMatchObject({
      onChain: true,
      tip,
      limit: poolLimit,
    });
  });

  it("passes a custom pool deposit scan limit through L1 state loading", async () => {
    const { sdk, logicManager } = testSdk();
    const findDeposits = vi.spyOn(logicManager, "findDeposits").mockImplementation(() => none());
    const client = {
      getTipHeader: () => Promise.resolve(tip),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: () => none(),
    } as unknown as ccc.Client;
    const poolDepositLimit = defaultFindCellsLimit + 100;

    await sdk.getL1State(client, [], { poolDepositLimit });

    expect(findDeposits.mock.calls[0]?.[1]).toMatchObject({
      onChain: true,
      tip,
      limit: poolDepositLimit,
    });
  });

  it("passes a custom order scan limit through L1 state loading", async () => {
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const orderManager = new OrderManager(order, [], udt);
    const findOrders = vi.spyOn(orderManager, "findOrders").mockImplementation(async function* () {
      await Promise.resolve();
      yield* [] as OrderGroup[];
    });
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, [])),
      new LogicManager(logic, [], new DaoManager(dao, [])),
      orderManager,
      [],
    );
    const client = {
      getTipHeader: () => Promise.resolve(headerLike(1n)),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: () => none(),
    } as unknown as ccc.Client;
    const orderLimit = defaultFindCellsLimit + 100;

    await sdk.getL1State(client, [], { orderLimit });

    expect(findOrders.mock.calls[0]?.[1]).toMatchObject({
      onChain: true,
      limit: orderLimit,
    });
  });

  it("fails closed when the chain tip changes during L1 state scanning", async () => {
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const firstTip = headerLike(1n, { hash: hash("01") });
    const secondTip = headerLike(2n, { hash: hash("02") });
    const getTipHeader = vi
      .fn<ccc.Client["getTipHeader"]>()
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(secondTip);
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, [])),
      new LogicManager(logic, [], new DaoManager(dao, [])),
      new OrderManager(order, [], udt),
      [],
    );
    const client = {
      getTipHeader,
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: () => none(),
    } as unknown as ccc.Client;

    await expect(sdk.getL1State(client, [])).rejects.toThrow(
      "L1 state scan crossed chain tip",
    );
  });

  it("fails closed when the chain tip changes during account state scanning", async () => {
    const accountLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const firstTip = headerLike(1n, { hash: hash("01") });
    const secondTip = headerLike(2n, { hash: hash("02") });
    const getTipHeader = vi
      .fn<ccc.Client["getTipHeader"]>()
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(secondTip);
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, [])),
      new LogicManager(logic, [], new DaoManager(dao, [])),
      new OrderManager(order, [], udt),
      [],
    );
    const client = {
      getTipHeader,
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: () => none(),
    } as unknown as ccc.Client;

    await expect(sdk.getL1AccountState(client, [accountLock])).rejects.toThrow(
      "L1 state scan crossed chain tip",
    );
  });
});

describe("IckbSdk.getAccountState", () => {
  it("collects account cells, receipts, withdrawals, and native iCKB balance", async () => {
    const accountLock = script("11");
    const udt = script("66");
    const receipt = { ckbValue: 13n, udtValue: 17n } as ReceiptCell;
    const withdrawal = { owned: { isReady: true }, ckbValue: 19n } as WithdrawalGroup;
    const udtCell = ccc.Cell.from({
      outPoint: { txHash: hash("90"), index: 0n },
      cellOutput: { capacity: 7n, lock: accountLock, type: udt },
      outputData: "0x01",
    });
    const capacityCell = ccc.Cell.from({
      outPoint: { txHash: hash("91"), index: 0n },
      cellOutput: { capacity: 5n, lock: accountLock },
      outputData: "0x",
    });
    const daoManager = new DaoManager(script("33"), []);
    const logicManager = new LogicManager(script("22"), [], daoManager);
    const ownedOwnerManager = new OwnedOwnerManager(script("44"), [], daoManager);
    const ickbUdt = fakeIckbUdt(udt);
    vi.spyOn(ickbUdt, "infoFrom").mockResolvedValue({
      capacity: 7n,
      balance: 11n,
      count: 1,
    } as never);
    vi.spyOn(logicManager, "findReceipts").mockImplementation(() => once(receipt));
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => once(withdrawal));
    const sdk = new IckbSdk(
      ickbUdt,
      ownedOwnerManager,
      logicManager,
      new OrderManager(script("55"), [], udt),
      [],
    );
    const client = {
      findCellsOnChain: async function* () {
        yield capacityCell;
        yield udtCell;
        await Promise.resolve();
      },
    } as unknown as ccc.Client;

    const state = await sdk.getAccountState(client, [accountLock, accountLock], tip);

    expect(state.capacityCells).toEqual([capacityCell]);
    expect(state.nativeUdtCells).toEqual([udtCell]);
    expect(state.nativeUdtCapacity).toBe(7n);
    expect(state.nativeUdtBalance).toBe(11n);
    expect(state.receipts).toEqual([receipt]);
    expect(state.withdrawalGroups).toEqual([withdrawal]);
    expect(ickbUdt.infoFrom).toHaveBeenCalledWith(client, [udtCell]);
  });

  it("allows account cell scanning to exactly reach the limit", async () => {
    const accountLock = script("11");
    const udt = script("66");
    const daoManager = new DaoManager(script("33"), []);
    const logicManager = new LogicManager(script("22"), [], daoManager);
    const ownedOwnerManager = new OwnedOwnerManager(script("44"), [], daoManager);
    vi.spyOn(logicManager, "findReceipts").mockImplementation(() => none());
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      logicManager,
      new OrderManager(script("55"), [], udt),
      [],
    );
    const cell = ccc.Cell.from({
      outPoint: { txHash: hash("92"), index: 0n },
      cellOutput: { capacity: 5n, lock: accountLock },
      outputData: "0x",
    });
    const client = {
      findCellsOnChain: () => repeat(defaultFindCellsLimit, cell),
    } as unknown as ccc.Client;

    await expect(sdk.getAccountState(client, [accountLock], tip)).resolves.toBeDefined();
  });

  it("fails closed when account cell scanning exceeds the limit", async () => {
    const accountLock = script("11");
    const udt = script("66");
    const daoManager = new DaoManager(script("33"), []);
    const logicManager = new LogicManager(script("22"), [], daoManager);
    const ownedOwnerManager = new OwnedOwnerManager(script("44"), [], daoManager);
    vi.spyOn(logicManager, "findReceipts").mockImplementation(() => none());
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      logicManager,
      new OrderManager(script("55"), [], udt),
      [],
    );
    const cell = ccc.Cell.from({
      outPoint: { txHash: hash("92"), index: 0n },
      cellOutput: { capacity: 5n, lock: accountLock },
      outputData: "0x",
    });
    const client = {
      findCellsOnChain: () => repeat(defaultFindCellsLimit + 1, cell),
    } as unknown as ccc.Client;

    await expect(sdk.getAccountState(client, [accountLock], tip)).rejects.toThrow(
      `account scan reached limit ${String(defaultFindCellsLimit)}`,
    );
  });
});

function dep(byte: string): ccc.CellDep {
  return ccc.CellDep.from({
    outPoint: { txHash: hash(byte), index: 0n },
    depType: "code",
  });
}

function depositCell(
  byte: string,
  logic: ccc.Script,
  dao: ccc.Script,
  depositHeader: ccc.ClientBlockHeader,
  tipHeader: ccc.ClientBlockHeader,
  options?: { isReady?: boolean },
): IckbDepositCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: logic,
      type: dao,
    },
    outputData: DaoManager.depositData(),
  });
  return {
    cell,
    headers: [{ header: depositHeader }, { header: tipHeader }],
    interests: 0n,
    maturity: ccc.Epoch.from([1n, 0n, 1n]),
    isReady: options?.isReady ?? false,
    isDeposit: true,
    ckbValue: cell.cellOutput.capacity,
    udtValue: ccc.fixedPointFrom(100000),
    [Symbol("isIckbDeposit")]: true,
  } as unknown as IckbDepositCell;
}

function receiptCell(
  byte: string,
  lock: ccc.Script,
  logic: ccc.Script,
  header: ccc.ClientBlockHeader,
): ReceiptCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock,
      type: logic,
    },
    outputData: ReceiptData.encode({
      depositQuantity: 1,
      depositAmount: ccc.fixedPointFrom(100000),
    }),
  });
  return {
    cell,
    header: { header, txHash: cell.outPoint.txHash },
    ckbValue: cell.cellOutput.capacity,
    udtValue: ccc.fixedPointFrom(100000),
  };
}

function makeOrderGroup(options: {
  orderScript: ccc.Script;
  udtScript: ccc.Script;
  ownerLock: ccc.Script;
  txHashByte: string;
  orderTxHashByte?: string;
  ratio?: { ckbScale: bigint; udtScale: bigint };
  orderCapacity?: bigint;
  udtValue?: bigint;
}): { group: OrderGroup; orderCell: ccc.Cell; masterCell: ccc.Cell } {
  const masterOutPoint = ccc.OutPoint.from({
    txHash: hash(options.txHashByte),
    index: 1n,
  });
  const orderCell = ccc.Cell.from({
    outPoint: { txHash: hash(options.orderTxHashByte ?? "74"), index: 0n },
    cellOutput: {
      capacity: options.orderCapacity ?? ccc.fixedPointFrom(100),
      lock: options.orderScript,
      type: options.udtScript,
    },
    outputData: OrderData.from({
        udtValue: options.udtValue ?? 0n,
        master: { type: "absolute", value: masterOutPoint },
        info: Info.create(true, options.ratio ?? { ckbScale: 1n, udtScale: 1n }),
      }).toBytes(),
  });
  const masterCell = ccc.Cell.from({
    outPoint: masterOutPoint,
    cellOutput: {
      capacity: ccc.fixedPointFrom(61),
      lock: options.ownerLock,
      type: options.orderScript,
    },
    outputData: "0x",
  });
  const order = OrderCell.mustFrom(orderCell);

  return {
    group: new OrderGroup(new MasterCell(masterCell), order, order),
    orderCell,
    masterCell,
  };
}

function readyWithdrawalGroup(options: {
  ownerLock: ccc.Script;
  ownedOwner: ccc.Script;
  dao: ccc.Script;
  depositHeader: ccc.ClientBlockHeader;
  withdrawalHeader: ccc.ClientBlockHeader;
}): WithdrawalGroup {
  const ownedCell = ccc.Cell.from({
    outPoint: { txHash: hash("75"), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: options.ownedOwner,
      type: options.dao,
    },
    outputData: ccc.mol.Uint64LE.encode(options.depositHeader.number),
  });
  const owner = new OwnerCell(
    ccc.Cell.from({
      outPoint: { txHash: hash("76"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(61),
        lock: options.ownerLock,
        type: options.ownedOwner,
      },
      outputData: OwnerData.encode({ ownedDistance: -1n }),
    }),
  );
  return new WithdrawalGroup({
    cell: ownedCell,
    headers: [
      { header: options.depositHeader },
      { header: options.withdrawalHeader },
    ],
    interests: 0n,
    maturity: ccc.Epoch.from([1n, 0n, 1n]),
    isReady: true,
    isDeposit: false,
    ckbValue: ownedCell.cellOutput.capacity,
    udtValue: 0n,
  }, owner);
}
