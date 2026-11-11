import { ccc } from "@ckb-ccc/core";
import { capacityCell, script, StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { completeTransaction } from "../../../src/complete.ts";
import { CHAINS, DAO, ICKB_LOGIC, ICKB_UDT } from "../../../src/constants.ts";
import {
  fundedSigner,
  mustComplete,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { hash, state, transactionWithOutputs } from "../base/support/sdk_core_support.ts";

describe("completeTransaction", () => {
  registerFundingTests();
  registerSweepTests();
  registerIckbTests();
  registerFailureTests();
});

function registerFundingTests(): void {
  it("funds from the given plain cells and creates exact plain change", async () => {
    const lock = script("11");
    const source = capacityCell(ccc.fixedPointFrom(200), lock, "81");
    const { client, signer } = fundedSigner([source], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(40), lock }, "0x");
    const feeRate = 1_000n;

    const { tx: completed, plannedFee } = mustComplete(
      await completeTransaction(tx, {
        signer,
        state: state({ feeRate, cells: [source] }),
      }),
    );

    expect(completed.inputs).toHaveLength(1);
    expect(completed.inputs[0]?.previousOutput.eq(source.outPoint)).toBe(true);
    expect(completed.outputs).toHaveLength(2);
    const change = Array.from(completed.outputCells)[1];
    expect(change?.cellOutput.lock.eq(lock)).toBe(true);
    expect(change?.cellOutput.type).toBeUndefined();
    expect(change?.outputData).toBe("0x");
    expect(plannedFee).toBe(completed.estimateFee(feeRate));
    await expect(completed.getFee(client)).resolves.toBe(plannedFee);
    expect(tx.inputs).toHaveLength(0);
  });

  it("changes to the state's change lock, not the signer's or the cells' locks", async () => {
    const recommended = script("11");
    const secondary = script("12");
    const changeLock = script("13");
    const cells = [
      capacityCell(ccc.fixedPointFrom(200), recommended, "82"),
      capacityCell(ccc.fixedPointFrom(200), secondary, "83"),
      udtCell("84", secondary, ICKB_UDT, 5n),
    ];
    const { signer } = fundedSigner(cells, [recommended, secondary]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(250), lock: changeLock }, "0x");

    const { tx: completed } = mustComplete(
      await completeTransaction(tx, {
        signer,
        state: state({ feeRate: 1_000n, cells, changeLock }),
      }),
    );

    expect(completed.inputs).toHaveLength(3);
    // The given output, then the iCKB change and the plain change.
    expect(completed.outputs).toHaveLength(3);
    expect(completed.outputs.every(({ lock }) => lock.eq(changeLock))).toBe(true);
    expect(completed.getOutputsUdtBalance(ICKB_UDT)).toBe(5n);
  });

  it("does not add a caller-supplied input twice when it reappears in the cells", async () => {
    const lock = script("11");
    const existing = capacityCell(ccc.fixedPointFrom(200), lock, "87");
    const additional = capacityCell(ccc.fixedPointFrom(200), lock, "88");
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addInput(existing);
    tx.addOutput({ capacity: ccc.fixedPointFrom(250), lock }, "0x");

    const { tx: completed } = mustComplete(
      await completeTransaction(tx, {
        signer,
        state: state({ feeRate: 1_000n, cells: [existing, additional] }),
      }),
    );

    expect(completed.inputs.map((input) => input.previousOutput.toHex())).toEqual([
      existing.outPoint.toHex(),
      additional.outPoint.toHex(),
    ]);
  });

  it("names an input the builders spent twice", async () => {
    const lock = script("11");
    const existing = capacityCell(ccc.fixedPointFrom(200), lock, "89");
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addInput(existing);
    tx.addInput(existing);

    await expect(
      completeTransaction(tx, {
        signer,
        state: state({ feeRate: 1_000n }),
      }),
    ).rejects.toThrow(`Input ${existing.outPoint.toHex()} is spent twice`);
  });
}

function registerSweepTests(): void {
  it("spends every offered cell, as the state offers them, and adds no other", async () => {
    const lock = script("11");
    const small = capacityCell(ccc.fixedPointFrom(70), lock, "90");
    const large = capacityCell(ccc.fixedPointFrom(300), lock, "91");
    const udt = udtCell("92", lock, ICKB_UDT, 5n);
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(61), lock }, "0x");

    const { tx: completed } = mustComplete(
      await completeTransaction(tx, {
        signer,
        state: state({ feeRate: 1_000n, cells: [small, udt, large] }),
      }),
    );

    expect(completed.inputs.map((input) => input.previousOutput.toHex())).toEqual([
      small.outPoint.toHex(),
      udt.outPoint.toHex(),
      large.outPoint.toHex(),
    ]);
    // One plain change and one iCKB change carry the whole offer.
    expect(completed.outputs).toHaveLength(3);
    expect(completed.getOutputsUdtBalance(ICKB_UDT)).toBe(5n);
  });

  it("funds the fee from the offer alone, and falls short rather than add a cell", async () => {
    const lock = script("11");
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(100), lock }, "0x");

    await expect(
      completeTransaction(tx, {
        signer,
        state: state({
          feeRate: 1_000n,
          cells: [capacityCell(ccc.fixedPointFrom(100), lock, "97")],
        }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "insufficient-capacity" });
  });
}

function registerIckbTests(): void {
  it("spends every offered iCKB cell and returns the surplus as change", async () => {
    const lock = script("11");
    const type = ICKB_UDT;
    const cells = [
      udtCell("93", lock, type, 30n),
      udtCell("94", lock, type, 80n),
      capacityCell(ccc.fixedPointFrom(500), lock, "95"),
    ];
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput(
      { capacity: ccc.fixedPointFrom(150), lock, type },
      ccc.numLeToBytes(100n, 16),
    );

    const { tx: completed } = mustComplete(
      await completeTransaction(tx, {
        signer,
        state: state({ feeRate: 1_000n, cells }),
      }),
    );

    expect(completed.inputs).toHaveLength(3);
    expect(completed.getOutputsUdtBalance(ICKB_UDT)).toBe(110n);
    // The signer's client serves the testnet genesis, so completion adds testnet's dep group.
    expect(completed.cellDeps).toEqual([
      ccc.CellDep.from({ outPoint: CHAINS.testnet.depGroup, depType: "depGroup" }),
    ]);
  });

  it("fails typed when the given iCKB cells cannot cover the outputs", async () => {
    const lock = script("11");
    const type = ICKB_UDT;
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput(
      { capacity: ccc.fixedPointFrom(150), lock, type },
      ccc.numLeToBytes(100n, 16),
    );

    await expect(
      completeTransaction(tx, {
        signer,
        state: state({ feeRate: 1_000n, cells: [udtCell("96", lock, type, 40n)] }),
      }),
    ).resolves.toEqual({ ok: false, reason: "insufficient-ickb" });
  });
}

function registerFailureTests(): void {
  it("returns a shortfall instead of routing sub-minimum change into a protocol output", async () => {
    const lock = script("11");
    const source = capacityCell(ccc.fixedPointFrom(50), lock, "84");
    const { signer } = fundedSigner([source], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(40), lock, type: ICKB_LOGIC }, "0x");
    const original = tx.toHex();

    await expect(
      completeTransaction(tx, {
        signer,
        state: state({ feeRate: 1_000n, cells: [source] }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "insufficient-capacity" });
    expect(tx.toHex()).toBe(original);
  });

  it("does not reinterpret a pre-existing plain output as fee change", async () => {
    const lock = script("11");
    const source = capacityCell(ccc.fixedPointFrom(50), lock, "89");
    const { signer } = fundedSigner([source], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(40), lock }, "0x");
    const original = tx.toHex();

    await expect(
      completeTransaction(tx, {
        signer,
        state: state({ feeRate: 1_000n, cells: [source] }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "insufficient-capacity" });
    expect(tx.toHex()).toBe(original);
  });

  it("reports DAO output 65 rather than hiding change in an existing output", async () => {
    const lock = script("11");
    const source = capacityCell(ccc.fixedPointFrom(10_000), lock, "85");
    const { signer } = fundedSigner([source], [lock]);
    const tx = transactionWithOutputs(64, lock);
    const first = tx.outputs[0];
    if (first === undefined) {
      throw new Error("Expected DAO output");
    }
    first.type = DAO;

    await expect(
      completeTransaction(tx, {
        signer,
        state: state({ feeRate: 1_000n, cells: [source] }),
      }),
    ).resolves.toEqual({ ok: false, reason: "dao-output-limit" });
    expect(tx.outputs).toHaveLength(64);
  });

  it("preserves non-capacity failures from signer preparation", async () => {
    const lock = script("11");
    const failure = new Error("wallet preparation failed");
    const signer = new RejectingPrepareSigner(new StubClient(), lock, failure);

    await expect(
      completeTransaction(ccc.Transaction.default(), {
        signer,
        state: state({ feeRate: 1_000n }),
      }),
    ).rejects.toBe(failure);
  });
}

function udtCell(
  byte: string,
  lock: ccc.Script,
  type: ccc.Script,
  balance: ccc.Num,
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: { capacity: ccc.fixedPointFrom(150), lock, type },
    outputData: ccc.numLeToBytes(balance, 16),
  });
}

class RejectingPrepareSigner extends ccc.SignerCkbScriptReadonly {
  private readonly failure: Error;

  constructor(client: ccc.Client, lock: ccc.Script, failure: Error) {
    super(client, lock);
    this.failure = failure;
  }

  public override async prepareTransaction(): Promise<ccc.Transaction> {
    await Promise.resolve();
    throw this.failure;
  }
}
