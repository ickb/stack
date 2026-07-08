import { ccc } from "@ckb-ccc/core";
import {
  DaoManager,
  type DaoDepositCell,
  type DaoWithdrawalRequestCell,
} from "@ickb/dao";
import { describe, expect, it, vi } from "vitest";
import {
  ickbDepositCellFrom,
  OwnerCell,
  receiptCellFrom,
  WithdrawalGroup,
} from "../../src/cells.ts";
import { IckbUdt, ickbValue } from "../../src/udt.ts";
import {
  byte32FromByte,
  clientWithHeader,
  headerLike,
  RECEIPT_PREFIX_DECODING_SUITE,
  receiptCell,
  receiptOutputData,
  script,
  signerWithCells,
  StubClient,
  transactionWithHeader,
  xudtCell,
} from "./support/cells_support.ts";

describe(RECEIPT_PREFIX_DECODING_SUITE, () => {
  registerReceiptCellFromPrefixTests();
  registerReceiptCellFromFailureTests();
  registerIckbDepositCellFromTests();
  registerCompleteByPrefixTests();
  registerConcurrentHeaderTests();
  registerRepeatedHeaderTests();
});

function registerReceiptCellFromPrefixTests(): void {
  it("lets receiptCellFrom ignore trailing bytes", async () => {
    const logic = script("33");
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const outputData = receiptOutputData(2, ccc.fixedPointFrom(100000));
    const cell = receiptCell(outputData, logic);

    const receipt = await receiptCellFrom({
      cell,
      client: clientWithHeader(header),
    });
    const receiptFromOutPoint = await receiptCellFrom({
      outpoint: cell.outPoint,
      client: new StubClient({
        getCell: async (): ReturnType<ccc.Client["getCell"]> => {
          await Promise.resolve();
          return cell;
        },
        getTransactionWithHeader: async (): ReturnType<
          ccc.Client["getTransactionWithHeader"]
        > => {
          await Promise.resolve();
          return transactionWithHeader(header);
        },
      }),
    });

    expect(receipt.ckbValue).toBe(ccc.fixedPointFrom(100082));
    expect(receipt.udtValue).toBe(ccc.fixedPointFrom(200000));
    expect(receiptFromOutPoint.cell.outPoint.toHex()).toBe(cell.outPoint.toHex());
  });

  it("rejects malformed receipt payloads with out point context", async () => {
    const logic = script("33");
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const cell = receiptCell("0x12", logic);

    await expect(
      receiptCellFrom({ cell, client: clientWithHeader(header) }),
    ).rejects.toThrow(`Invalid iCKB receipt payload at ${cell.outPoint.toHex()}: 0x12`);
  });

  it("exposes owner and withdrawal group CKB values", () => {
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const owner = new OwnerCell(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("12"), index: 1n },
        cellOutput: { capacity: 61n, lock: script("22"), type: script("33") },
        outputData: "0x0000000000000000",
      }),
    );
    const owned = withdrawalRequestCell(header);

    expect(owner.ckbValue).toBe(owner.cell.cellOutput.capacity);
    expect(new WithdrawalGroup(owned, owner).ckbValue).toBe(
      owned.ckbValue + owner.cell.cellOutput.capacity,
    );
  });

  it("rejects owner markers that point before output zero", () => {
    const owner = new OwnerCell(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("12"), index: 0n },
        cellOutput: { capacity: 61n, lock: script("22"), type: script("33") },
        outputData: "0xffffffff",
      }),
    );

    expect(() => owner.getOwned()).toThrow(
      `Owner marker ${owner.cell.outPoint.toHex()} points before output 0`,
    );
  });

  it("rejects malformed owner marker payloads with out point context", () => {
    const owner = new OwnerCell(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("12"), index: 0n },
        cellOutput: { capacity: 61n, lock: script("22"), type: script("33") },
        outputData: "0x12",
      }),
    );

    expect(() => owner.getOwned()).toThrow(
      `Invalid owner marker payload at ${owner.cell.outPoint.toHex()}: 0x12`,
    );
  });
}

function registerReceiptCellFromFailureTests(): void {
  it("rejects missing receipt cells and transaction headers", async () => {
    const logic = script("33");
    const cell = receiptCell(receiptOutputData(1, ccc.fixedPointFrom(100000)), logic);
    const client = new StubClient({
      getCell: async (): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        return undefined;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return undefined;
      },
    });

    await expect(receiptCellFrom({ outpoint: cell.outPoint, client })).rejects.toThrow(
      `Cell not found for out point ${cell.outPoint.toHex()}`,
    );
    await expect(receiptCellFrom({ cell, client })).rejects.toThrow(
      `Header not found for txHash ${cell.outPoint.txHash} at ${cell.outPoint.toHex()}`,
    );
  });

  it("preserves receipt coordinates when cell and header reads fail", async () => {
    const logic = script("33");
    const cell = receiptCell(receiptOutputData(1, ccc.fixedPointFrom(100000)), logic);
    const cellError = new Error("cell rpc failed");
    const headerError = new Error("header rpc failed");
    const failedCellClient = new StubClient({
      getCell: async (): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        throw cellError;
      },
    });
    const failedHeaderClient = new StubClient({
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        throw headerError;
      },
    });

    await expect(
      receiptCellFrom({ outpoint: cell.outPoint, client: failedCellClient }),
    ).rejects.toMatchObject({
      message: `Failed to load cell for out point ${cell.outPoint.toHex()}`,
      cause: cellError,
    });
    await expect(
      receiptCellFrom({ cell, client: failedHeaderClient }),
    ).rejects.toMatchObject({
      message: `Failed to load transaction header for txHash ${cell.outPoint.txHash} at ${cell.outPoint.toHex()}`,
      cause: headerError,
    });
  });
}

function registerIckbDepositCellFromTests(): void {
  it("brands only DAO deposits locked by the expected logic script", () => {
    const logic = script("33");
    const dao = script("44");
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const deposit = daoDepositCell(logic, dao, header);
    const wrongLogicDeposit = daoDepositCell(script("55"), dao, header);

    expect(ickbDepositCellFrom(deposit, logic).udtValue).toBe(
      ickbValue(deposit.cell.capacityFree, header),
    );
    expect(() => ickbDepositCellFrom(wrongLogicDeposit, logic)).toThrow(
      `DAO deposit ${wrongLogicDeposit.cell.outPoint.toHex()} lock does not match iCKB logic script`,
    );
  });
}

function daoDepositCell(
  lock: ccc.Script,
  dao: ccc.Script,
  header: ccc.ClientBlockHeader,
): DaoDepositCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("14"), index: 0n },
    cellOutput: { capacity: ccc.fixedPointFrom(100082), lock, type: dao },
    outputData: DaoManager.depositData(),
  });
  return {
    cell,
    headers: [{ header }, { header }],
    ckbValue: cell.cellOutput.capacity,
    udtValue: 0n,
    interests: 0n,
    maturity: header.epoch,
    isDeposit: true,
    isReady: true,
  };
}

function withdrawalRequestCell(header: ccc.ClientBlockHeader): DaoWithdrawalRequestCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("13"), index: 0n },
    cellOutput: { capacity: 100n, lock: script("22"), type: script("33") },
    outputData: ccc.mol.Uint64LE.encode(header.number),
  });
  return {
    cell,
    headers: [{ header }, { header }],
    ckbValue: 100n,
    udtValue: 0n,
    interests: 0n,
    maturity: header.epoch,
    isDeposit: false,
    isReady: true,
  };
}

function registerCompleteByPrefixTests(): void {
  it("completeBy values receipt prefixes with trailing bytes", async () => {
    const logic = script("33");
    const type = script("55");
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const outputData = receiptOutputData(3, ccc.fixedPointFrom(100000));
    const cell = receiptCell(outputData, logic);
    const ickbUdt = new IckbUdt(
      { txHash: byte32FromByte("44"), index: 0n },
      type,
      { txHash: byte32FromByte("66"), index: 0n },
      logic,
      new DaoManager(script("77"), []),
    );
    const tx = ccc.Transaction.from({
      outputs: [{ lock: script("22"), type }],
      outputsData: [
        ccc.numLeToBytes(ickbValue(ccc.fixedPointFrom(100000), header) * 3n, 16),
      ],
    });
    tx.addInput(cell);
    const signer = signerWithCells([], clientWithHeader(header));

    const completed = await ickbUdt.completeBy(tx, signer);

    expect(completed.inputs).toHaveLength(1);
    expect(completed.outputs).toHaveLength(1);
  });
}

function registerConcurrentHeaderTests(): void {
  it("fetches receipt and deposit headers concurrently", async () => {
    const logic = script("33");
    const dao = script("44");
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const receipt = receiptCell(receiptOutputData(2, ccc.fixedPointFrom(100000)), logic);
    const deposit = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("88"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(100082), lock: logic, type: dao },
      outputData: "0x0000000000000000",
    });
    const type = script("55");
    const ickbUdt = new IckbUdt(
      { txHash: byte32FromByte("44"), index: 0n },
      type,
      { txHash: byte32FromByte("66"), index: 0n },
      logic,
      new DaoManager(dao, []),
    );
    const { promise: receiptFetch, resolve: resolveReceipt } =
      Promise.withResolvers<
        Awaited<ReturnType<ccc.Client["getTransactionWithHeader"]>>
      >();
    const { promise: depositFetch, resolve: resolveDeposit } =
      Promise.withResolvers<
        Awaited<ReturnType<ccc.Client["getTransactionWithHeader"]>>
      >();
    const requests: ccc.Hex[] = [];
    const client = new StubClient({
      getTransactionWithHeader: async (
        txHash,
      ): ReturnType<ccc.Client["getTransactionWithHeader"]> => {
        const hash = ccc.hexFrom(txHash);
        requests.push(hash);
        return hash === receipt.outPoint.txHash ? receiptFetch : depositFetch;
      },
    });

    const tx = ccc.Transaction.from({
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(50n, 16)],
    });
    tx.addInput(receipt);
    tx.addInput(deposit);
    const signer = signerWithCells(
      [xudtCell(ickbValue(deposit.capacityFree, header) + 50n, type)],
      client,
    );

    const completedPromise = ickbUdt.completeBy(tx, signer);

    await vi.waitFor(() => {
      expect(requests).toEqual([receipt.outPoint.txHash, deposit.outPoint.txHash]);
    });
    resolveDeposit(transactionWithHeader(header));
    await Promise.resolve();
    resolveReceipt(transactionWithHeader(header));

    const completed = await completedPromise;

    expect(completed.inputs).toHaveLength(2);
  });
}

function registerRepeatedHeaderTests(): void {
  it("values repeated-header receipt and deposit inputs", async () => {
    const logic = script("33");
    const dao = script("44");
    const txHash = byte32FromByte("88");
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const receipt = ccc.Cell.from({
      outPoint: { txHash, index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: script("22"),
        type: logic,
      },
      outputData: receiptOutputData(2, ccc.fixedPointFrom(100000)),
    });
    const deposit = ccc.Cell.from({
      outPoint: { txHash, index: 1n },
      cellOutput: { capacity: ccc.fixedPointFrom(100082), lock: logic, type: dao },
      outputData: "0x0000000000000000",
    });
    const ickbUdt = new IckbUdt(
      { txHash: byte32FromByte("44"), index: 0n },
      script("55"),
      { txHash: byte32FromByte("66"), index: 0n },
      logic,
      new DaoManager(dao, []),
    );

    const tx = ccc.Transaction.default();
    tx.addInput(receipt);
    tx.addInput(deposit);
    let headerRequests = 0;
    const signer = signerWithCells(
      [],
      new StubClient({
        getTransactionWithHeader: async (): ReturnType<
          ccc.Client["getTransactionWithHeader"]
        > => {
          headerRequests += 1;
          await Promise.resolve();
          return transactionWithHeader(header);
        },
      }),
    );

    const completed = await ickbUdt.completeBy(tx, signer);

    expect(headerRequests).toBe(1);
    expect(completed.outputsData).toContain(
      ccc.hexFrom(
        ccc.numLeToBytes(
          ickbValue(ccc.fixedPointFrom(100000), header) * 2n -
            ickbValue(deposit.capacityFree, header),
          16,
        ),
      ),
    );
  });
}
