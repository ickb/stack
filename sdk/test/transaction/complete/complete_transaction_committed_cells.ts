import { ccc } from "@ckb-ccc/core";
import { capacityCell, script, StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { DaoOutputLimitError } from "../../../src/dao.ts";
import { SWEEP_INPUT_LIMIT } from "../../../src/sdk.ts";
import {
  fundedSigner,
  testSdk,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import {
  baseTip,
  conversionContext,
  hash,
  transactionWithOutputs,
} from "../base/support/sdk_core_support.ts";

describe("IckbSdk.completeTransaction", () => {
  registerFundingTests();
  registerSweepTests();
  registerIckbTests();
  registerFailureTests();
});

function registerFundingTests(): void {
  it("funds from the given plain cells and creates exact plain change", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const source = capacityCell(ccc.fixedPointFrom(200), lock, "81");
    const { client, signer } = fundedSigner([source], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(40), lock }, "0x");
    const feeRate = 1_000n;

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate,
      cells: [source],
      protocolCells: [],
      tip: baseTip,
    });

    expect(completed.inputs).toHaveLength(1);
    expect(completed.inputs[0]?.previousOutput.eq(source.outPoint)).toBe(true);
    expect(completed.outputs).toHaveLength(2);
    const change = Array.from(completed.outputCells)[1];
    expect(change?.cellOutput.lock.eq(lock)).toBe(true);
    expect(change?.cellOutput.type).toBeUndefined();
    expect(change?.outputData).toBe("0x");
    await expect(completed.getFee(client)).resolves.toBe(completed.estimateFee(feeRate));
    expect(tx.inputs).toHaveLength(0);
  });

  it("changes to the given lock, else the recommended one, whatever lock the cells carry", async () => {
    const { sdk } = testSdk({ completion: "real" });
    const recommended = script("11");
    const secondary = script("12");
    const cells = [
      capacityCell(ccc.fixedPointFrom(200), recommended, "82"),
      capacityCell(ccc.fixedPointFrom(200), secondary, "83"),
    ];
    const { signer } = fundedSigner(cells, [recommended, secondary]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(250), lock: recommended }, "0x");

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 1_000n,
      cells,
      protocolCells: [],
      tip: baseTip,
    });
    const toSecondary = await sdk.completeTransaction(tx, {
      signer,
      lock: secondary,
      feeRate: 1_000n,
      cells,
      protocolCells: [],
      tip: baseTip,
    });

    expect(completed.inputs).toHaveLength(2);
    expect(
      Array.from(completed.outputCells).at(-1)?.cellOutput.lock.eq(recommended),
    ).toBe(true);
    expect(
      Array.from(toSecondary.outputCells).at(-1)?.cellOutput.lock.eq(secondary),
    ).toBe(true);
  });

  it("does not add a caller-supplied input twice when it reappears in the cells", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const existing = capacityCell(ccc.fixedPointFrom(200), lock, "87");
    const additional = capacityCell(ccc.fixedPointFrom(200), lock, "88");
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addInput(existing);
    tx.addOutput({ capacity: ccc.fixedPointFrom(250), lock }, "0x");

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 1_000n,
      cells: [existing, additional],
      protocolCells: [],
      tip: baseTip,
    });

    expect(completed.inputs.map((input) => input.previousOutput.toHex())).toEqual([
      existing.outPoint.toHex(),
      additional.outPoint.toHex(),
    ]);
  });

  it("names an input the builders spent twice", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const existing = capacityCell(ccc.fixedPointFrom(200), lock, "89");
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addInput(existing);
    tx.addInput(existing);

    await expect(
      sdk.completeTransaction(tx, {
        signer,
        feeRate: 1_000n,
        cells: [],
        protocolCells: [],
        tip: baseTip,
      }),
    ).rejects.toThrow(`Input ${existing.outPoint.toHex()} is spent twice`);
  });
}

function registerSweepTests(): void {
  it("sweeps every given cell largest first while the input limit allows", async () => {
    const { sdk, ickbUdt, lock } = testSdk({ completion: "real" });
    const small = capacityCell(ccc.fixedPointFrom(70), lock, "90");
    const large = capacityCell(ccc.fixedPointFrom(300), lock, "91");
    const udt = udtCell("92", lock, ickbUdt.script, 5n);
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(61), lock }, "0x");

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 1_000n,
      cells: [small, udt, large],
      protocolCells: [],
      tip: baseTip,
    });

    expect(completed.inputs.map((input) => input.previousOutput.toHex())).toEqual([
      udt.outPoint.toHex(),
      large.outPoint.toHex(),
      small.outPoint.toHex(),
    ]);
    // One plain change and one iCKB change carry the whole account.
    expect(completed.outputs).toHaveLength(3);
    expect(completed.getOutputsUdtBalance(ickbUdt.script)).toBe(5n);
  });

  it("stops sweeping at the input limit and still funds the fee beyond it", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const { signer } = fundedSigner([], [lock]);
    const cells = plainCells(SWEEP_INPUT_LIMIT + 2, lock, ccc.fixedPointFrom(100));
    // The swept cells fall just short of the output, so the fee loop adds one more.
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(100 * SWEEP_INPUT_LIMIT), lock }, "0x");

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 1_000n,
      cells,
      protocolCells: [],
      tip: baseTip,
    });

    expect(completed.inputs).toHaveLength(SWEEP_INPUT_LIMIT + 1);
  });

  it("moves iCKB cells first, plain cells last, and reports a sweep the limit cut short", async () => {
    // A move is amount zero to another lock, so the sweep is the transaction. The limit
    // may cut it, so the iCKB cells go first and the plain cells left behind can still fund
    // the next move's fee.
    const { sdk, ickbUdt, lock } = testSdk({ completion: "real" });
    const { signer } = fundedSigner([], [lock]);
    const ickb = ["a1", "a2", "a3"].map((byte) =>
      udtCell(byte, lock, ickbUdt.script, 10n),
    );
    const dust = plainCells(SWEEP_INPUT_LIMIT, lock, ccc.fixedPointFrom(62));
    const funding = capacityCell(ccc.fixedPointFrom(1000), lock, "ff");

    const result = await sdk.buildConversionTransaction({
      direction: "ckb-to-ickb",
      amount: 0n,
      lock: script("77"),
      signer,
      context: conversionContext({
        system: { feeRate: 1_000n },
        cells: [...dust, funding, ...ickb],
      }),
    });

    if (!result.ok) {
      throw new Error("Expected a completed move");
    }
    const inputs = result.tx.inputs.map((input) => input.previousOutput.toHex());
    expect(inputs.slice(0, 4)).toEqual(
      [...ickb, funding].map((cell) => cell.outPoint.toHex()),
    );
    expect(inputs).toHaveLength(SWEEP_INPUT_LIMIT);
    expect(result.isSweepComplete).toBe(false);
  });

  it("funds iCKB past the limit, then stops the sweep", async () => {
    const { sdk, ickbUdt, lock } = testSdk({ completion: "real" });
    const type = ickbUdt.script;
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput(
      { capacity: ccc.fixedPointFrom(150), lock, type },
      ccc.numLeToBytes(BigInt(SWEEP_INPUT_LIMIT + 1), 16),
    );
    const cells = [
      ...manyCells(SWEEP_INPUT_LIMIT + 2, "d1", () => udtCell("d1", lock, type, 1n)),
      capacityCell(ccc.fixedPointFrom(1000), lock, "e5"),
    ];

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 1_000n,
      cells,
      protocolCells: [],
      tip: baseTip,
    });

    // Required funding passes the limit; neither sweep adds a cell beyond it.
    expect(completed.inputs).toHaveLength(SWEEP_INPUT_LIMIT + 1);
    expect(completed.getOutputsUdtBalance(ickbUdt.script)).toBe(
      BigInt(SWEEP_INPUT_LIMIT + 1),
    );
  });
}

function registerIckbTests(): void {
  it("funds iCKB outputs from the largest iCKB cells and returns the surplus as change", async () => {
    const { sdk, ickbUdt, lock } = testSdk({ completion: "real" });
    const type = ickbUdt.script;
    const largest = udtCell("94", lock, type, 80n);
    const cells = [
      udtCell("93", lock, type, 30n),
      largest,
      capacityCell(ccc.fixedPointFrom(500), lock, "95"),
    ];
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput(
      { capacity: ccc.fixedPointFrom(150), lock, type },
      ccc.numLeToBytes(100n, 16),
    );

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 1_000n,
      cells,
      protocolCells: [],
      tip: baseTip,
    });

    expect(completed.inputs[0]?.previousOutput.eq(largest.outPoint)).toBe(true);
    expect(completed.getOutputsUdtBalance(ickbUdt.script)).toBe(110n);
    expect(completed.cellDeps).toEqual(ickbUdt.cellDeps);
  });

  it("fails typed when the given iCKB cells cannot cover the outputs", async () => {
    const { sdk, ickbUdt, lock } = testSdk({ completion: "real" });
    const type = ickbUdt.script;
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput(
      { capacity: ccc.fixedPointFrom(150), lock, type },
      ccc.numLeToBytes(100n, 16),
    );

    await expect(
      sdk.completeTransaction(tx, {
        signer,
        feeRate: 1_000n,
        cells: [udtCell("96", lock, type, 40n)],
        protocolCells: [],
        tip: baseTip,
      }),
    ).rejects.toMatchObject({ name: "IckbError", code: "insufficient_ickb" });
  });
}

function registerFailureTests(): void {
  it("fails typed instead of routing sub-minimum change into a protocol output", async () => {
    const { sdk, logicManager, lock } = testSdk({ completion: "real" });
    const source = capacityCell(ccc.fixedPointFrom(50), lock, "84");
    const { signer } = fundedSigner([source], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput(
      { capacity: ccc.fixedPointFrom(40), lock, type: logicManager.script },
      "0x",
    );
    const original = tx.toHex();

    await expect(
      sdk.completeTransaction(tx, {
        signer,
        feeRate: 1_000n,
        cells: [source],
        protocolCells: [],
        tip: baseTip,
      }),
    ).rejects.toMatchObject({
      name: "IckbError",
      code: "insufficient_capacity",
    });
    expect(tx.toHex()).toBe(original);
  });

  it("does not reinterpret a pre-existing plain output as fee change", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const source = capacityCell(ccc.fixedPointFrom(50), lock, "89");
    const { signer } = fundedSigner([source], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(40), lock }, "0x");
    const original = tx.toHex();

    await expect(
      sdk.completeTransaction(tx, {
        signer,
        feeRate: 1_000n,
        cells: [source],
        protocolCells: [],
        tip: baseTip,
      }),
    ).rejects.toMatchObject({ code: "insufficient_capacity" });
    expect(tx.toHex()).toBe(original);
  });

  it("rejects DAO output 65 rather than hiding change in an existing output", async () => {
    const { sdk, logicManager, lock } = testSdk({ completion: "real" });
    const source = capacityCell(ccc.fixedPointFrom(10_000), lock, "85");
    const { signer } = fundedSigner([source], [lock]);
    const tx = transactionWithOutputs(64, lock);
    const first = tx.outputs[0];
    if (first === undefined) {
      throw new Error("Expected DAO output");
    }
    first.type = logicManager.dao.script;

    await expect(
      sdk.completeTransaction(tx, {
        signer,
        feeRate: 1_000n,
        cells: [source],
        protocolCells: [],
        tip: baseTip,
      }),
    ).rejects.toBeInstanceOf(DaoOutputLimitError);
    expect(tx.outputs).toHaveLength(64);
  });

  it("preserves non-capacity failures from signer preparation", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const failure = new Error("wallet preparation failed");
    const signer = new RejectingPrepareSigner(new StubClient(), lock, failure);

    await expect(
      sdk.completeTransaction(ccc.Transaction.default(), {
        signer,
        feeRate: 1_000n,
        cells: [],
        protocolCells: [],
        tip: baseTip,
      }),
    ).rejects.toBe(failure);
  });
}

/** `count` cells sharing one transaction hash, since `hash` spans only 256 values. */
function manyCells(
  count: number,
  byte: string,
  cell: (index: number) => ccc.Cell,
): ccc.Cell[] {
  return Array.from({ length: count }, (_, index) => {
    const { cellOutput, outputData } = cell(index);
    return ccc.Cell.from({
      outPoint: { txHash: hash(byte), index: BigInt(index) },
      cellOutput,
      outputData,
    });
  });
}

function plainCells(count: number, lock: ccc.Script, capacity: ccc.Num): ccc.Cell[] {
  return manyCells(count, "d0", () => capacityCell(capacity, lock, "d0"));
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
