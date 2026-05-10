import { ccc } from "@ckb-ccc/core";
import { Info, Ratio, type OrderGroup } from "@ickb/order";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DaoManager } from "@ickb/dao";
import {
  type IckbDepositCell,
  LogicManager,
  OwnedOwnerManager,
  type ReceiptCell,
  type WithdrawalGroup,
} from "@ickb/core";
import { OrderManager } from "@ickb/order";
import { defaultFindCellsLimit } from "@ickb/utils";
import {
  completeIckbTransaction,
  IckbSdk,
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
  return ccc.ClientBlockHeader.from({
    compactTarget: 0n,
    dao: { c: 0n, ar: 1000n, s: 0n, u: 0n },
    epoch: [1n, 0n, 1n],
    extraHash: hash("aa"),
    hash: hash("bb"),
    nonce: 0n,
    number,
    parentHash: hash("cc"),
    proposalsHash: hash("dd"),
    timestamp: 0n,
    transactionsRoot: hash("ee"),
    version: 0n,
    ...overrides,
  });
}

const tip = headerLike(0n);

function hash(byte: string): `0x${string}` {
  return `0x${byte.repeat(32)}`;
}

function script(byte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: hash(byte),
    hashType: "type",
    args: "0x",
  });
}

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
    const requestedDeposit = {
      udtValue: 10n,
    } as IckbDepositCell;
    const requiredLiveDeposit = {
      cell: ccc.Cell.from({
        outPoint: { txHash: hash("90"), index: 0n },
        cellOutput: { capacity: 1n, lock: logic },
        outputData: "0x",
      }),
    } as IckbDepositCell;

    vi.spyOn(ownedOwnerManager, "requestWithdrawal").mockImplementation(
      async (txLike, deposits, lock) => {
        await Promise.resolve();
        steps.push("request");
        expect(deposits).toEqual([requestedDeposit]);
        expect(lock).toEqual(botLock);
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
    expect(tx.cellDeps).toContainEqual(
      ccc.CellDep.from({
        outPoint: requiredLiveDeposit.cell.outPoint,
        depType: "code",
      }),
    );
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
    const requestedDeposit = {
      udtValue: 10n,
    } as IckbDepositCell;
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
    const requestedDeposit = {
      udtValue: 10n,
    } as IckbDepositCell;

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
          deposits: [{ udtValue: 10n } as IckbDepositCell],
          lock: botLock,
        },
      }),
    ).rejects.toThrow("Transaction has different inputs and outputs lengths");
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

  it("surfaces post-broadcast polling failures with the broadcast hash", async () => {
    const txHash = hash("a4");
    const onSent = vi.fn();

    try {
      await sendAndWaitForCommit(
        {
          client: {
            getTransaction: vi.fn().mockRejectedValue(new Error("RPC down")),
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
        message: "Transaction confirmation failed: RPC down",
        txHash,
        status: "sent",
        isTimeout: true,
      });
    }

    expect(onSent).toHaveBeenCalledWith(txHash);
  });
});

describe("IckbSdk.getL1State snapshot detection", () => {
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
      isReady: false,
      ckbValue: 1n,
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
    const logicManager = new LogicManager(logic, [], new DaoManager(dao, []));
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, []));
    const deposit = {
      isReady: false,
      ckbValue: 1n,
      maturity: { toUnix: () => 1n },
    } as unknown as IckbDepositCell;
    vi.spyOn(logicManager, "findDeposits").mockImplementation(() =>
      repeat(defaultFindCellsLimit + 1, deposit)
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

    await expect(sdk.getL1State(client, [])).rejects.toThrow(
      `iCKB deposit scan reached limit ${String(defaultFindCellsLimit)}`,
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
