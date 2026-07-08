import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import type { DaoWithdrawalRequestCell } from "../src/cells.ts";
import { DaoManager } from "../src/index.ts";
import {
  byte32FromByte,
  client,
  headerLike,
  headerWithHash,
  script,
} from "./support/dao_support.ts";

describe("DaoManager.withdraw", () => {
  registerWithdrawConstructionTests();
  registerWithdrawValidationTests();
});

function registerWithdrawConstructionTests(): void {
  it("writes since, header deps, and witness inputType for withdrawals", async () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);

    const tx = await manager.withdraw(ccc.Transaction.default(), [withdrawal], client());

    expect(tx.headerDeps).toEqual([depositHeader.hash, withdrawHeader.hash]);
    expect(tx.inputs).toHaveLength(1);
    const since = tx.inputs[0]?.since;
    if (since === undefined) {
      throw new Error("Expected withdrawal input since");
    }
    expect(ccc.Since.from(since).metric).toBe("epoch");
    expect(ccc.Since.from(since).value).toBe(withdrawal.maturity.toNum());
    expect(tx.getWitnessArgsAt(0)?.inputType).toBe(ccc.hexFrom(ccc.numLeToBytes(0n, 8)));
  });

  it("does not duplicate withdrawal header deps", async () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    const tx = ccc.Transaction.default();
    tx.headerDeps.push(depositHeader.hash, withdrawHeader.hash);

    const updated = await manager.withdraw(tx, [withdrawal], client());

    expect(updated.headerDeps).toEqual([depositHeader.hash, withdrawHeader.hash]);
  });

  it("preserves an existing non-input witness by shifting it after the new input", async () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    const tx = ccc.Transaction.default();
    const preservedWitness = ccc.WitnessArgs.from({ inputType: "0xab" }).toHex();
    tx.witnesses.push(preservedWitness);

    const updated = await manager.withdraw(tx, [withdrawal], client());

    expect(updated.getWitnessArgsAt(0)?.inputType).toBe(
      ccc.hexFrom(ccc.numLeToBytes(0n, 8)),
    );
    expect(updated.witnesses[1]).toBe(preservedWitness);
  });

  it("leaves transactions unchanged when ready-only withdrawals are pending", async () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const pending = {
      ...withdrawalCell(manager, depositHeader, withdrawHeader),
      isReady: false,
    };
    const tx = ccc.Transaction.default();

    await expect(
      manager.withdraw(tx, [pending], client(), { isReadyOnly: true }),
    ).resolves.toEqual(tx);
  });
}

function registerWithdrawValidationTests(): void {
  it("rejects withdrawal witnesses whose input type is already set", async () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    const tx = ccc.Transaction.default();
    const addInput = tx.addInput.bind(tx);
    tx.addInput = (input): number => {
      const inputCount = addInput(input);
      tx.setWitnessArgsAt(inputCount - 1, ccc.WitnessArgs.from({ inputType: "0xab" }));
      return inputCount;
    };

    await expect(manager.withdraw(tx, [withdrawal], client())).rejects.toThrow(
      "Witnesses of withdrawal request already in use",
    );
  });

  it("rejects withdrawal requests whose cell output has no DAO type script", async () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    withdrawal.cell.cellOutput.type = undefined;

    await expect(
      manager.withdraw(ccc.Transaction.default(), [withdrawal], client()),
    ).rejects.toThrow(
      `DAO withdrawal request ${withdrawal.cell.outPoint.toHex()} does not match this DAO script`,
    );
  });

  it("rejects withdrawal requests whose header tx hash does not match the cell", async () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    withdrawal.headers[1] = { ...withdrawal.headers[1], txHash: byte32FromByte("44") };

    await expect(
      manager.withdraw(ccc.Transaction.default(), [withdrawal], client()),
    ).rejects.toThrow("header txHash");
  });

  it("rejects withdrawal requests whose payload deposit block does not match the deposit header", async () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    withdrawal.cell.outputData = ccc.hexFrom(ccc.mol.Uint64LE.encode(9n));

    await expect(
      manager.withdraw(ccc.Transaction.default(), [withdrawal], client()),
    ).rejects.toThrow("deposit block 9 does not match header block 1");
  });

  it("rejects malformed withdrawal request payloads with out point context", async () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    withdrawal.cell.outputData = "0x12";

    await expect(
      manager.withdraw(ccc.Transaction.default(), [withdrawal], client()),
    ).rejects.toThrow(
      `Invalid DAO withdrawal request payload at ${withdrawal.cell.outPoint.toHex()}: 0x12`,
    );
  });

  it("rejects duplicated or already-spent withdrawal request inputs", async () => {
    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal = withdrawalCell(manager, depositHeader, withdrawHeader);
    const tx = ccc.Transaction.default();
    tx.addInput(withdrawal.cell);

    await expect(
      manager.withdraw(ccc.Transaction.default(), [withdrawal, withdrawal], client()),
    ).rejects.toThrow(
      `DAO withdrawal request ${withdrawal.cell.outPoint.toHex()} is duplicated`,
    );
    await expect(manager.withdraw(tx, [withdrawal], client())).rejects.toThrow(
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
