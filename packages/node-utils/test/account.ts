import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  accountPlainCkbBalance,
  postTransactionAccountPlainCkbBalance,
  signerAccountLocks,
} from "../src/index.ts";
import {
  AddressStubSigner,
  byte32FromByte,
  capacityCell,
  script,
} from "./support/node_utils_support.ts";

describe("account locks and balances", () => {
  it("keeps the primary signer lock first and deduplicates account locks", async () => {
    const primaryLock = script("11");
    const primaryLockCopy = ccc.Script.from(primaryLock);
    const otherLock = script("22");
    const signer = new AddressStubSigner([
      new ccc.Address(otherLock, "ckt"),
      new ccc.Address(primaryLockCopy, "ckt"),
    ]);

    await expect(signerAccountLocks(signer, primaryLock)).resolves.toEqual([
      primaryLock,
      otherLock,
    ]);
  });

  it("counts account plain CKB from owned plain capacity cells only", () => {
    const { lock, otherLock, unspent, typed, data } = accountCellFixture();

    expect(
      accountPlainCkbBalance(
        [unspent, typed, data, capacityCell(100n, otherLock, "ee")],
        [lock],
      ),
    ).toBe(ccc.fixedPointFrom(2000));
  });

  it("counts post-transaction account plain CKB from unspent cells and new outputs", () => {
    const { lock, otherLock, spent, unspent, typed, data } = accountCellFixture();
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.outputs.push(
      ccc.CellOutput.from({ capacity: ccc.fixedPointFrom(300), lock }),
      ccc.CellOutput.from({
        capacity: ccc.fixedPointFrom(500),
        lock,
        type: script("33"),
      }),
      ccc.CellOutput.from({ capacity: ccc.fixedPointFrom(700), lock: otherLock }),
    );
    tx.outputsData.push("0x", "0x", "0x");

    expect(
      postTransactionAccountPlainCkbBalance(tx, [spent, unspent, typed, data], [lock]),
    ).toBe(ccc.fixedPointFrom(2300));
  });
});

function accountCellFixture(): {
  lock: ccc.Script;
  otherLock: ccc.Script;
  spent: ccc.Cell;
  unspent: ccc.Cell;
  typed: ccc.Cell;
  data: ccc.Cell;
} {
  const lock = script("11");
  const otherLock = script("22");
  return {
    lock,
    otherLock,
    spent: capacityCell(ccc.fixedPointFrom(1000), lock, "aa"),
    unspent: capacityCell(ccc.fixedPointFrom(2000), lock, "bb"),
    typed: ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("cc"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(4000), lock, type: script("33") },
      outputData: "0x",
    }),
    data: ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("dd"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(8000), lock },
      outputData: "0x1234",
    }),
  };
}
