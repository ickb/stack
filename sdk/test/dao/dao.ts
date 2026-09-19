import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, headerLike, script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import {
  assertDaoOutputLimit,
  DAO_OUTPUT_LIMIT,
  DaoOutputLimitError,
  DEFAULT_LOCK_UP_WINDOW,
  depositData,
  depositMaturity,
  isDaoDeposit,
  isDaoWithdrawalRequest,
} from "../../src/dao.ts";

function transactionWithPlainOutputs(count: number): ccc.Transaction {
  const tx = ccc.Transaction.default();
  for (let index = 0; index < count; index += 1) {
    tx.addOutput({ capacity: 1n, lock: script("99") }, "0x");
  }
  return tx;
}

describe("assertDaoOutputLimit", () => {
  const daoScript = script("11");

  it("accepts oversized transactions with fully resolved non-DAO inputs", () => {
    const tx = transactionWithPlainOutputs(DAO_OUTPUT_LIMIT + 1);
    tx.addInput(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("21"), index: 0n },
        cellOutput: { capacity: 1n, lock: script("99") },
        outputData: "0x",
      }),
    );

    expect(() => {
      assertDaoOutputLimit(tx, daoScript);
    }).not.toThrow();
  });

  it("accepts transactions at the limit even when inputs are unresolved", () => {
    const tx = transactionWithPlainOutputs(DAO_OUTPUT_LIMIT);
    tx.addInput({ previousOutput: { txHash: byte32FromByte("22"), index: 0n } });

    expect(() => {
      assertDaoOutputLimit(tx, daoScript);
    }).not.toThrow();
  });

  it("throws a typed output-limit error past the limit for a DAO output", () => {
    const tx = transactionWithPlainOutputs(DAO_OUTPUT_LIMIT - 1);
    tx.addOutput({ capacity: 1n, lock: script("99"), type: daoScript }, "0x");

    expect(() => {
      assertDaoOutputLimit(tx, daoScript);
    }).not.toThrow();

    tx.addOutput({ capacity: 1n, lock: script("99") }, "0x");
    expect(() => {
      assertDaoOutputLimit(tx, daoScript);
    }).toThrow(DaoOutputLimitError);
  });

  it("checks resolved DAO inputs without a client lookup", () => {
    const tx = transactionWithPlainOutputs(DAO_OUTPUT_LIMIT + 1);
    tx.addInput(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("22"), index: 0n },
        cellOutput: { capacity: 1n, lock: script("99"), type: daoScript },
        outputData: depositData(),
      }),
    );

    expect(() => {
      assertDaoOutputLimit(tx, daoScript);
    }).toThrow(DaoOutputLimitError);
  });

  it("refuses an oversized transaction whose input it cannot resolve", () => {
    const tx = transactionWithPlainOutputs(DAO_OUTPUT_LIMIT + 1);
    tx.addInput({ previousOutput: { txHash: byte32FromByte("24"), index: 0n } });

    expect(() => {
      assertDaoOutputLimit(tx, daoScript);
    }).toThrow("NervosDAO transaction has 65 output cells, exceeding the limit of 64");
  });
});

describe("DAO cell shapes", () => {
  const daoScript = script("11");

  it("tells deposits from withdrawal requests by their data", () => {
    const deposit = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("22"), index: 0n },
      cellOutput: { capacity: 1n, lock: script("99"), type: daoScript },
      outputData: depositData(),
    });
    const request = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("23"), index: 0n },
      cellOutput: { capacity: 1n, lock: script("99"), type: daoScript },
      outputData: ccc.mol.Uint64LE.encode(7n),
    });
    const plain = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("24"), index: 0n },
      cellOutput: { capacity: 1n, lock: script("99") },
      outputData: depositData(),
    });

    expect(isDaoDeposit(deposit, daoScript)).toBe(true);
    expect(isDaoDeposit(request, daoScript)).toBe(false);
    expect(isDaoDeposit(plain, daoScript)).toBe(false);
    expect(isDaoWithdrawalRequest(request, daoScript)).toBe(true);
    expect(isDaoWithdrawalRequest(deposit, daoScript)).toBe(false);
  });
});

describe("depositMaturity", () => {
  it("rolls a claim at the exact min boundary to the next cycle", () => {
    const depositHeader = headerLike({ epoch: [1n, 0n, 1n], number: 1n });
    const tip = headerLike({ epoch: [180n, 23n, 24n], number: 2n });
    const claim = ccc.calcDaoClaimEpoch(depositHeader, tip);

    const { maturity, isReady } = depositMaturity(claim, tip, DEFAULT_LOCK_UP_WINDOW);

    expect(isReady).toBe(false);
    expect(maturity.eq(claim.add([180n, 0n, 1n]))).toBe(true);
  });

  it("keeps a claim at the exact max boundary out of the ready window", () => {
    const depositHeader = headerLike({ epoch: [1n, 0n, 1n], number: 1n });
    const tip = headerLike({ epoch: [163n, 0n, 1n], number: 2n });
    const claim = ccc.calcDaoClaimEpoch(depositHeader, tip);

    const { maturity, isReady } = depositMaturity(claim, tip, DEFAULT_LOCK_UP_WINDOW);

    expect(maturity.eq(claim)).toBe(true);
    expect(isReady).toBe(false);
  });

  it("reads a claim inside the window as ready", () => {
    const depositHeader = headerLike({ epoch: [1n, 0n, 1n], number: 1n });
    const tip = headerLike({ epoch: [170n, 0n, 1n], number: 2n });
    const claim = ccc.calcDaoClaimEpoch(depositHeader, tip);

    expect(depositMaturity(claim, tip, DEFAULT_LOCK_UP_WINDOW).isReady).toBe(true);
  });
});
