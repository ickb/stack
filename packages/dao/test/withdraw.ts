import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import type { DaoWithdrawalRequestCell } from "../src/cells.ts";
import { DAO_OUTPUT_LIMIT, DaoManager, DaoOutputLimitError } from "../src/index.ts";
import {
  byte32FromByte,
  headerLike,
  headerWithHash,
  script,
} from "./support/dao_support.ts";

describe("DaoManager.withdraw", () => {
  registerWithdrawConstructionTests();
  registerWithdrawValidationTests();
});

function registerWithdrawConstructionTests(): void {
  it("writes since, header deps, and witness inputType for withdrawals", () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);

    const tx = manager.withdraw(ccc.Transaction.default(), [withdrawal]);

    expect(tx.headerDeps).toEqual([depositHeader.hash, withdrawHeader.hash]);
    expect(tx.inputs).toHaveLength(1);
    const since = tx.inputs[0]?.since;
    if (since === undefined) {
      throw new Error("Expected withdrawal input since");
    }
    expect(ccc.Since.from(since).metric).toBe("epoch");
    expect(ccc.Since.from(since).value).toBe(withdrawal.maturity.toNum());
    expect(tx.getWitnessArgs(0)?.inputType).toBe(ccc.hexFrom(ccc.numLeToBytes(0n, 8)));
  });

  it("does not duplicate withdrawal header deps", () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    const tx = ccc.Transaction.default();
    tx.headerDeps.push(depositHeader.hash, withdrawHeader.hash);

    const updated = manager.withdraw(tx, [withdrawal]);

    expect(updated.headerDeps).toEqual([depositHeader.hash, withdrawHeader.hash]);
  });

  it("preserves an existing non-input witness by shifting it after the new input", () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    const tx = ccc.Transaction.default();
    const preservedWitness = ccc.WitnessArgs.from({ inputType: "0xab" }).toHex();
    tx.witnesses.push(preservedWitness);

    const updated = manager.withdraw(tx, [withdrawal]);

    expect(updated.getWitnessArgs(0)?.inputType).toBe(
      ccc.hexFrom(ccc.numLeToBytes(0n, 8)),
    );
    expect(updated.witnesses[1]).toBe(preservedWitness);
  });

  it("leaves transactions unchanged when ready-only withdrawals are pending", () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const pending = {
      ...withdrawalCell(manager, depositHeader, withdrawHeader),
      isReady: false,
    };
    const tx = ccc.Transaction.default();

    expect(manager.withdraw(tx, [pending], { isReadyOnly: true })).toEqual(tx);
  });

  it("rejects DAO withdrawals with more than 64 outputs", () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawal = withdrawalCell(manager, depositHeader, headerWithHash(2n, "99"));
    const tx = ccc.Transaction.default();
    for (let index = 0; index <= DAO_OUTPUT_LIMIT; index += 1) {
      tx.addOutput({ capacity: 1n, lock: script("44") }, "0x");
    }

    expect(() => manager.withdraw(tx, [withdrawal])).toThrow(DaoOutputLimitError);
  });
}

function registerWithdrawValidationTests(): void {
  it("rejects withdrawal witnesses whose input type is already set", () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    const tx = ccc.Transaction.default();
    const addInput = tx.addInput.bind(tx);
    tx.addInput = (input): number => {
      const inputCount = addInput(input);
      tx.setWitnessArgs(inputCount - 1, ccc.WitnessArgs.from({ inputType: "0xab" }));
      return inputCount;
    };

    expect(() => manager.withdraw(tx, [withdrawal])).toThrow(
      "Witnesses of withdrawal request already in use",
    );
  });

  it("rejects withdrawal requests whose cell output has no DAO type script", () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    withdrawal.cell.cellOutput.type = undefined;

    expect(() => manager.withdraw(ccc.Transaction.default(), [withdrawal])).toThrow(
      `DAO withdrawal request ${withdrawal.cell.outPoint.toHex()} does not match this DAO script`,
    );
  });

  it("rejects withdrawal requests whose header tx hash does not match the cell", () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    withdrawal.headers[1] = { ...withdrawal.headers[1], txHash: byte32FromByte("44") };

    expect(() => manager.withdraw(ccc.Transaction.default(), [withdrawal])).toThrow(
      "header txHash",
    );
  });

  it("rejects withdrawal requests whose payload deposit block does not match the deposit header", () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    withdrawal.cell.outputData = ccc.hexFrom(ccc.mol.Uint64LE.encode(9n));

    expect(() => manager.withdraw(ccc.Transaction.default(), [withdrawal])).toThrow(
      "deposit block 9 does not match header block 1",
    );
  });

  it("rejects malformed withdrawal request payloads with out point context", () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    withdrawal.cell.outputData = "0x12";

    expect(() => manager.withdraw(ccc.Transaction.default(), [withdrawal])).toThrow(
      `Invalid DAO withdrawal request payload at ${withdrawal.cell.outPoint.toHex()}: 0x12`,
    );
  });

  it("rejects duplicated or already-spent withdrawal request inputs", () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    const tx = ccc.Transaction.default();
    tx.addInput(withdrawal.cell);

    expect(() =>
      manager.withdraw(ccc.Transaction.default(), [withdrawal, withdrawal]),
    ).toThrow(`DAO withdrawal request ${withdrawal.cell.outPoint.toHex()} is duplicated`);
    expect(() => manager.withdraw(tx, [withdrawal])).toThrow(
      `DAO withdrawal request ${withdrawal.cell.outPoint.toHex()} is already being spent`,
    );
  });
}

function withdrawalCell(
  manager: DaoManager,
  depositHeader: ccc.ClientBlockHeader,
  withdrawHeader: ccc.ClientBlockHeader,
): DaoWithdrawalRequestCell {
  return {
    cell: ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("22"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: script("33", "0x1234"),
        type: manager.script,
      },
      outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
    }),
    isDeposit: false,
    headers: [
      { header: depositHeader },
      { header: withdrawHeader, txHash: byte32FromByte("22") },
    ],
    interests: 0n,
    maturity: ccc.Epoch.from([180n, 0n, 1n]),
    isReady: true,
    ckbValue: ccc.fixedPointFrom(100082),
    udtValue: 0n,
  };
}
