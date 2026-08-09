import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  assertDaoOutputLimit,
  DAO_OUTPUT_LIMIT,
  DaoManager,
  DaoOutputLimitError,
  DaoOutputLimitIndeterminateError,
} from "../src/index.ts";
import { cellOutputLikeFrom } from "../src/transaction_shape.ts";
import {
  byte32FromByte,
  client,
  depositCell,
  headerLike,
  REQUEST_WITHDRAWAL_SUITE,
  script,
  StubClient,
} from "./support/dao_support.ts";

describe(REQUEST_WITHDRAWAL_SUITE, () => {
  it("omits an output type when preserving a plain cell output", () => {
    const lock = script("11");
    const output = ccc.CellOutput.from({ capacity: 42n, lock });

    const like = cellOutputLikeFrom(output);

    expect(like).not.toHaveProperty("type");
    expect(like.capacity).toBe(42n);
    expect(like.lock).toBe(output.lock);
  });

  it("adds DAO deposit outputs and leaves empty deposits unchanged", () => {
    const manager = new DaoManager(script("11"), [
      ccc.CellDep.from({
        outPoint: ccc.OutPoint.from({ txHash: byte32FromByte("aa"), index: 0n }),
        depType: "code",
      }),
    ]);
    const baseTx = ccc.Transaction.default();

    expect(manager.deposit(baseTx, [], script("22"))).toEqual(baseTx);

    const tx = manager.deposit(
      ccc.Transaction.default(),
      [ccc.fixedPointFrom(100082)],
      script("22"),
    );

    expect(tx.cellDeps).toHaveLength(1);
    expect(tx.outputs).toHaveLength(1);
    expect(tx.outputs[0]?.type?.eq(manager.script)).toBe(true);
    expect(tx.outputsData).toEqual([DaoManager.depositData()]);
  });

  it("rejects DAO deposits that produce output 65", () => {
    const manager = new DaoManager(script("11"), []);
    const tx = transactionWithPlainOutputs(DAO_OUTPUT_LIMIT);

    expect(() => manager.deposit(tx, [ccc.fixedPointFrom(100082)], script("22"))).toThrow(
      DaoOutputLimitError,
    );
  });

  it("always rejects withdrawal locks with different args size", () => {
    const manager = new DaoManager(script("11"), []);
    const deposit = depositCell(manager, { lock: script("33", "0x1234") });

    expect(() =>
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [deposit],
        script("44", "0x12"),
      ),
    ).toThrow("Withdrawal request lock args has different size from deposit");
  });
});

describe("assertDaoOutputLimit resolved activity", () => {
  it("accepts oversized transactions with fully resolved non-DAO inputs", () => {
    const daoScript = script("11");
    const tx = ccc.Transaction.default();
    tx.addInput(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("21"), index: 0n },
        cellOutput: { capacity: 1n, lock: script("99") },
        outputData: "0x",
      }),
    );
    for (let index = 0; index <= DAO_OUTPUT_LIMIT; index += 1) {
      tx.addOutput({ capacity: 1n, lock: script("99") }, "0x");
    }

    expect(() => {
      assertDaoOutputLimit(tx, daoScript);
    }).not.toThrow();
  });

  it("accepts transactions at the limit even when inputs are unresolved", () => {
    const daoScript = script("11");
    const tx = ccc.Transaction.default();
    tx.addInput({ previousOutput: { txHash: byte32FromByte("22"), index: 0n } });
    for (let index = 0; index < DAO_OUTPUT_LIMIT; index += 1) {
      tx.addOutput({ capacity: 1n, lock: script("99") }, "0x");
    }

    expect(() => {
      assertDaoOutputLimit(tx, daoScript);
    }).not.toThrow();
  });

  it("throws a typed output-limit error for the configured DAO script", () => {
    const daoScript = script("11");
    const tx = ccc.Transaction.default();
    for (let index = 0; index < DAO_OUTPUT_LIMIT; index += 1) {
      tx.addOutput(
        {
          capacity: 1n,
          lock: script("99"),
          type: index === 0 ? daoScript : undefined,
        },
        "0x",
      );
    }

    expect(() => {
      assertDaoOutputLimit(tx, daoScript);
    }).not.toThrow();

    tx.addOutput({ capacity: 1n, lock: script("99") }, "0x");
    expect(() => {
      assertDaoOutputLimit(tx, daoScript);
    }).toThrow(DaoOutputLimitError);
  });

  it("checks resolved DAO inputs without a client lookup", () => {
    const daoScript = script("11");
    const tx = ccc.Transaction.default();
    tx.addInput(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("22"), index: 0n },
        cellOutput: { capacity: 1n, lock: script("99"), type: daoScript },
        outputData: DaoManager.depositData(),
      }),
    );
    for (let index = 0; index <= DAO_OUTPUT_LIMIT; index += 1) {
      tx.addOutput({ capacity: 1n, lock: script("99") }, "0x");
    }

    expect(() => {
      assertDaoOutputLimit(tx, daoScript);
    }).toThrow(DaoOutputLimitError);
  });
});

describe("assertDaoOutputLimit unresolved inputs", () => {
  it("rejects an unresolved DAO-shaped input as indeterminate", () => {
    const daoScript = script("11");
    const daoCell = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("23"), index: 0n },
      cellOutput: { capacity: 1n, lock: script("99"), type: daoScript },
      outputData: DaoManager.depositData(),
    });
    const tx = transactionWithPlainOutputs(DAO_OUTPUT_LIMIT + 1);
    tx.addInput({ previousOutput: daoCell.outPoint });

    expect(() => {
      assertDaoOutputLimit(tx, daoScript);
    }).toThrow(DaoOutputLimitIndeterminateError);
  });

  it("rejects an unresolved non-DAO input as indeterminate", () => {
    const daoScript = script("11");
    const plainCell = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("24"), index: 0n },
      cellOutput: { capacity: 1n, lock: script("99") },
      outputData: "0x",
    });
    const tx = transactionWithPlainOutputs(DAO_OUTPUT_LIMIT + 1);
    tx.addInput({ previousOutput: plainCell.outPoint });

    expect(() => {
      assertDaoOutputLimit(tx, daoScript);
    }).toThrow(
      "Cannot determine whether transaction with 65 output cells uses NervosDAO because an input cell output is unresolved",
    );
  });
});

function transactionWithPlainOutputs(count: number): ccc.Transaction {
  const tx = ccc.Transaction.default();
  for (let index = 0; index < count; index += 1) {
    tx.addOutput({ capacity: 1n, lock: script("99") }, "0x");
  }
  return tx;
}

describe(REQUEST_WITHDRAWAL_SUITE, () => {
  registerRequestWithdrawalSelectionTests();
  registerRequestWithdrawalValidationTests();
});

function registerRequestWithdrawalSelectionTests(): void {
  it("keeps non-ready deposits unless isReadyOnly is set", () => {
    const manager = new DaoManager(script("11"), []);
    const pending = depositCell(manager, { isReady: false, txHashByte: "22" });
    const ready = depositCell(manager, { isReady: true, txHashByte: "23" });

    const tx = manager.requestWithdrawal(
      ccc.Transaction.default(),
      [pending, ready],
      script("44"),
    );

    expect(tx.inputs).toHaveLength(2);
    expect(tx.outputs).toHaveLength(2);
    expect(tx.outputsData).toHaveLength(2);
  });

  it("filters non-ready deposits when isReadyOnly is set", () => {
    const manager = new DaoManager(script("11"), []);
    const pending = depositCell(manager, { isReady: false, txHashByte: "22" });
    const ready = depositCell(manager, { isReady: true, txHashByte: "23" });

    const tx = manager.requestWithdrawal(
      ccc.Transaction.default(),
      [pending, ready],
      script("44"),
      { isReadyOnly: true },
    );

    expect(tx.inputs).toHaveLength(1);
    expect(tx.outputs).toHaveLength(1);
    expect(tx.inputs[0]?.previousOutput.txHash).toBe(ready.cell.outPoint.txHash);
  });

  it("leaves the transaction unchanged when ready-only deposits are all pending", () => {
    const manager = new DaoManager(script("11"), []);
    const baseTx = ccc.Transaction.default();

    expect(
      manager.requestWithdrawal(
        baseTx,
        [depositCell(manager, { isReady: false })],
        script("44"),
        { isReadyOnly: true },
      ),
    ).toEqual(baseTx);
  });

  it("does not duplicate existing deposit header deps", () => {
    const manager = new DaoManager(script("11"), []);
    const deposit = depositCell(manager);
    const tx = ccc.Transaction.default();
    tx.headerDeps.push(deposit.headers[0].header.hash);

    const updated = manager.requestWithdrawal(tx, [deposit], script("44"));

    expect(updated.headerDeps).toEqual([deposit.headers[0].header.hash]);
  });

  it("requires matched input and output counts before appending requests", () => {
    const manager = new DaoManager(script("11"), []);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(1000), lock: script("55") }, "0x");

    expect(() =>
      manager.requestWithdrawal(tx, [depositCell(manager)], script("44")),
    ).toThrow("Transaction has different inputs and outputs lengths");
  });

  it("rejects withdrawal requests that produce output 65", () => {
    const manager = new DaoManager(script("11"), []);
    const tx = balancedTransactionWithPlainOutputs(DAO_OUTPUT_LIMIT);

    expect(() =>
      manager.requestWithdrawal(tx, [depositCell(manager)], script("44")),
    ).toThrow(DaoOutputLimitError);
  });
}

function registerRequestWithdrawalValidationTests(): void {
  it("rejects deposits whose DAO type script was erased", () => {
    const manager = new DaoManager(script("11"), []);
    const deposit = depositCell(manager);
    deposit.cell.cellOutput.type = undefined;

    expect(() =>
      manager.requestWithdrawal(ccc.Transaction.default(), [deposit], script("44")),
    ).toThrow(
      `DAO deposit ${deposit.cell.outPoint.toHex()} does not match this DAO script`,
    );
  });

  it("rejects deposits whose header tx hash does not match the cell", () => {
    const manager = new DaoManager(script("11"), []);
    const deposit = depositCell(manager);
    deposit.headers[0] = { ...deposit.headers[0], txHash: byte32FromByte("99") };

    expect(() =>
      manager.requestWithdrawal(ccc.Transaction.default(), [deposit], script("44")),
    ).toThrow("header txHash");
  });

  it("rejects duplicated or already-spent deposit inputs", () => {
    const manager = new DaoManager(script("11"), []);
    const deposit = depositCell(manager);
    const tx = ccc.Transaction.default();
    tx.addInput(deposit.cell);
    tx.addOutput(
      { capacity: deposit.cell.cellOutput.capacity, lock: script("44") },
      "0x",
    );

    expect(() =>
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [deposit, deposit],
        script("44"),
      ),
    ).toThrow(`DAO deposit ${deposit.cell.outPoint.toHex()} is duplicated`);
    expect(() => manager.requestWithdrawal(tx, [deposit], script("44"))).toThrow(
      `DAO deposit ${deposit.cell.outPoint.toHex()} is already being spent`,
    );
  });
}

function balancedTransactionWithPlainOutputs(count: number): ccc.Transaction {
  const tx = transactionWithPlainOutputs(count);
  for (let index = 0; index < count; index += 1) {
    tx.addInput(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("aa"), index: BigInt(index) },
        cellOutput: { capacity: 1n, lock: script("99") },
        outputData: "0x",
      }),
    );
  }
  return tx;
}

describe("DaoManager cell decoding ownership from out points", () => {
  it("loads DAO cells from out points before decoding", async () => {
    const manager = new DaoManager(script("11"), []);
    const deposit = depositCell(manager).cell;
    const withdrawal = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("23"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: script("33"),
        type: manager.script,
      },
      outputData: ccc.mol.Uint64LE.encode(1n),
    });
    const testClient = new StubClient({
      getCell: async (outPoint): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        return ccc.OutPoint.from(outPoint).eq(deposit.outPoint) ? deposit : withdrawal;
      },
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        await Promise.resolve();
        return headerLike(1n);
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return {
          transaction: ccc.ClientTransactionResponse.from({
            transaction: ccc.Transaction.default(),
            status: "committed",
          }),
          header: headerLike(2n),
        };
      },
    });

    await expect(
      manager.depositCellFrom(deposit.outPoint, testClient, { tip: headerLike(3n) }),
    ).resolves.toMatchObject({ isDeposit: true });
    await expect(
      manager.withdrawalRequestCellFrom(withdrawal.outPoint, testClient, {
        tip: headerLike(3n),
      }),
    ).resolves.toMatchObject({ isDeposit: false });
  });

  it("rejects missing cells loaded by out point", async () => {
    const manager = new DaoManager(script("11"), []);
    const missingOutPoint = ccc.OutPoint.from({
      txHash: byte32FromByte("22"),
      index: 0n,
    });
    const testClient = new StubClient({
      getCell: async (): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        return undefined;
      },
    });

    await expect(
      manager.depositCellFrom(missingOutPoint, testClient, { tip: headerLike(2n) }),
    ).rejects.toThrow(`Cell not found for out point ${missingOutPoint.toHex()}`);
    await expect(
      manager.withdrawalRequestCellFrom(missingOutPoint, testClient, {
        tip: headerLike(2n),
      }),
    ).rejects.toThrow(`Cell not found for out point ${missingOutPoint.toHex()}`);
  });
});

describe("DaoManager cell decoding ownership from out point failures", () => {
  it("preserves out point context when cell loads fail", async () => {
    const manager = new DaoManager(script("11"), []);
    const cellError = new Error("cell rpc failed");
    const outPoint = ccc.OutPoint.from({ txHash: byte32FromByte("22"), index: 0n });
    const testClient = new StubClient({
      getCell: async (): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        throw cellError;
      },
    });

    await expect(
      manager.depositCellFrom(outPoint, testClient, { tip: headerLike(2n) }),
    ).rejects.toMatchObject({
      message: `Failed to load cell for out point ${outPoint.toHex()}`,
      cause: cellError,
    });
  });
});

describe("DaoManager cell decoding ownership rejection paths", () => {
  it("rejects depositCellFrom on non-deposit cells", async () => {
    const manager = new DaoManager(script("11"), []);

    await expect(
      manager.depositCellFrom(
        ccc.Cell.from({
          outPoint: { txHash: byte32FromByte("22"), index: 0n },
          cellOutput: {
            capacity: ccc.fixedPointFrom(100082),
            lock: script("33"),
            type: manager.script,
          },
          outputData: ccc.mol.Uint64LE.encode(1n),
        }),
        client(),
        { tip: headerLike(2n) },
      ),
    ).rejects.toThrow("Not a deposit");
  });

  it("rejects withdrawalRequestCellFrom on non-withdrawal cells", async () => {
    const manager = new DaoManager(script("11"), []);

    await expect(
      manager.withdrawalRequestCellFrom(depositCell(manager).cell, client(), {
        tip: headerLike(2n),
      }),
    ).rejects.toThrow("Not a withdrawal request");
  });
});
