import { ccc } from "@ckb-ccc/core";
import { script, StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { DaoOutputLimitError } from "../../../src/dao.ts";
import { TRANSACTION_SIZE_BUDGET } from "../../../src/sdk.ts";
import {
  fundedSigner,
  testSdk,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import {
  conversionContext,
  hash,
  transactionWithOutputs,
} from "../base/support/sdk_core_support.ts";
import { COMPLETE_TRANSACTION_SUITE } from "./support/sdk_suite_titles.ts";

describe(COMPLETE_TRANSACTION_SUITE, () => {
  registerFundingTests();
  registerSweepTests();
  registerIckbTests();
  registerFailureTests();
});

function registerFundingTests(): void {
  it("funds from the given plain cells and creates exact plain change", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const source = plainCell("81", lock, ccc.fixedPointFrom(200));
    const { client, signer } = fundedSigner([source], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(40), lock }, "0x");
    const feeRate = 1_000n;

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate,
      cells: [source],
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
      plainCell("82", recommended, ccc.fixedPointFrom(200)),
      plainCell("83", secondary, ccc.fixedPointFrom(200)),
    ];
    const { signer } = fundedSigner(cells, [recommended, secondary]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(250), lock: recommended }, "0x");

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 1_000n,
      cells,
    });
    const toSecondary = await sdk.completeTransaction(tx, {
      signer,
      lock: secondary,
      feeRate: 1_000n,
      cells,
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
    const existing = plainCell("87", lock, ccc.fixedPointFrom(200));
    const additional = plainCell("88", lock, ccc.fixedPointFrom(200));
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addInput(existing);
    tx.addOutput({ capacity: ccc.fixedPointFrom(250), lock }, "0x");

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 1_000n,
      cells: [existing, additional],
    });

    expect(completed.inputs.map((input) => input.previousOutput.toHex())).toEqual([
      existing.outPoint.toHex(),
      additional.outPoint.toHex(),
    ]);
  });

  it("names an input the builders spent twice", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const existing = plainCell("89", lock, ccc.fixedPointFrom(200));
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addInput(existing);
    tx.addInput(existing);

    await expect(
      sdk.completeTransaction(tx, { signer, feeRate: 1_000n, cells: [] }),
    ).rejects.toThrow(`Input ${existing.outPoint.toHex()} is spent twice`);
  });
}

function registerSweepTests(): void {
  it("sweeps every given cell largest first while the size budget allows", async () => {
    const { sdk, ickbUdt, lock } = testSdk({ completion: "real" });
    const small = plainCell("90", lock, ccc.fixedPointFrom(70));
    const large = plainCell("91", lock, ccc.fixedPointFrom(300));
    const udt = udtCell("92", lock, ickbUdt.script, 5n);
    const { signer } = fundedSigner([], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(61), lock }, "0x");

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 1_000n,
      cells: [small, udt, large],
    });

    expect(completed.inputs.map((input) => input.previousOutput.toHex())).toEqual([
      udt.outPoint.toHex(),
      large.outPoint.toHex(),
      small.outPoint.toHex(),
    ]);
    // One plain change and one iCKB change carry the whole account.
    expect(completed.outputs).toHaveLength(3);
    expect(ickbUdt.outputBalance(completed)).toBe(5n);
  });

  it("stops sweeping at the size budget and still funds the fee beyond it", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const { signer } = fundedSigner([], [lock]);
    // Leave room for a handful of sweep inputs under the budget.
    const tx = fullBudgetTransaction(lock, 400);
    const dust = Array.from({ length: 40 }, (_, index) =>
      plainCell(index.toString(16).padStart(2, "0"), lock, ccc.fixedPointFrom(62)),
    );
    const funding = plainCell(
      "ff",
      lock,
      ccc.fixedPointFrom(61 * tx.outputs.length + 100),
    );

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 1_000n,
      cells: [...dust, funding],
    });

    // The largest cell is swept first, a little dust follows, the rest stays for later.
    expect(completed.inputs[0]?.previousOutput.eq(funding.outPoint)).toBe(true);
    expect(completed.inputs.length).toBeGreaterThan(1);
    expect(completed.inputs.length).toBeLessThan(dust.length + 1);
  });

  it("funds the fee from the reserve when the budget is already full", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const { signer } = fundedSigner([], [lock]);
    const tx = fullBudgetTransaction(lock);
    const half =
      ccc.fixedPointFrom(61 * tx.outputs.length) / 2n + ccc.fixedPointFrom(100);
    const cells = [plainCell("e1", lock, half), plainCell("e2", lock, half)];

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 1_000n,
      cells,
    });

    // Nothing fit under the budget, so both cells came from the fee loop one at a time.
    expect(completed.inputs).toHaveLength(2);
  });

  it("moves iCKB cells first, plain cells last, and reports a sweep the budget cut short", async () => {
    // A move is amount zero to another lock, so the sweep is the transaction. The budget
    // may cut it, so the iCKB cells go first and the plain cells left behind can still fund
    // the next move's fee (decisions amendment 52(al)).
    const { sdk, ickbUdt, lock } = testSdk({ completion: "real" });
    const { signer } = fundedSigner([], [lock]);
    const tx = fullBudgetTransaction(lock, 400);
    const ickb = ["a1", "a2", "a3"].map((byte) =>
      udtCell(byte, lock, ickbUdt.script, 10n),
    );
    const dust = Array.from({ length: 40 }, (_, index) =>
      plainCell(index.toString(16).padStart(2, "0"), lock, ccc.fixedPointFrom(62)),
    );
    const funding = plainCell(
      "ff",
      lock,
      ccc.fixedPointFrom(61 * tx.outputs.length + 100),
    );

    const result = await sdk.buildConversionTransaction(tx, {
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
    expect(inputs.length).toBeLessThan(ickb.length + dust.length + 1);
    expect(result.isSweepComplete).toBe(false);
  });

  it("stops the iCKB sweep at the budget once the outputs are covered", async () => {
    const { sdk, ickbUdt, lock } = testSdk({ completion: "real" });
    const type = ickbUdt.script;
    const { signer } = fundedSigner([], [lock]);
    const tx = fullBudgetTransaction(lock);
    tx.addOutput(
      { capacity: ccc.fixedPointFrom(150), lock, type },
      ccc.numLeToBytes(10n, 16),
    );
    const cells = [
      udtCell("e3", lock, type, 30n),
      udtCell("e4", lock, type, 20n),
      plainCell("e5", lock, ccc.fixedPointFrom(61 * tx.outputs.length + 400)),
    ];

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 1_000n,
      cells,
    });

    expect(ickbUdt.outputBalance(completed)).toBe(30n);
    expect(completed.inputs).toHaveLength(2);
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
      plainCell("95", lock, ccc.fixedPointFrom(500)),
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
    });

    expect(completed.inputs[0]?.previousOutput.eq(largest.outPoint)).toBe(true);
    expect(ickbUdt.outputBalance(completed)).toBe(110n);
    expect(completed.cellDeps).toHaveLength(2);
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
      }),
    ).rejects.toMatchObject({ name: "IckbError", code: "insufficient_ickb" });
  });
}

function registerFailureTests(): void {
  it("fails typed instead of routing sub-minimum change into a protocol output", async () => {
    const { sdk, logicManager, lock } = testSdk({ completion: "real" });
    const source = plainCell("84", lock, ccc.fixedPointFrom(50));
    const { signer } = fundedSigner([source], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput(
      { capacity: ccc.fixedPointFrom(40), lock, type: logicManager.script },
      "0x",
    );
    const original = tx.toHex();

    await expect(
      sdk.completeTransaction(tx, { signer, feeRate: 1_000n, cells: [source] }),
    ).rejects.toMatchObject({
      name: "IckbError",
      code: "insufficient_capacity",
    });
    expect(tx.toHex()).toBe(original);
  });

  it("does not reinterpret a pre-existing plain output as fee change", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const source = plainCell("89", lock, ccc.fixedPointFrom(50));
    const { signer } = fundedSigner([source], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(40), lock }, "0x");
    const original = tx.toHex();

    await expect(
      sdk.completeTransaction(tx, { signer, feeRate: 1_000n, cells: [source] }),
    ).rejects.toMatchObject({ code: "insufficient_capacity" });
    expect(tx.toHex()).toBe(original);
  });

  it("rejects DAO output 65 rather than hiding change in an existing output", async () => {
    const { sdk, logicManager, lock } = testSdk({ completion: "real" });
    const source = plainCell("85", lock, ccc.fixedPointFrom(10_000));
    const { signer } = fundedSigner([source], [lock]);
    const tx = transactionWithOutputs(64, lock);
    const first = tx.outputs[0];
    if (first === undefined) {
      throw new Error("Expected DAO output");
    }
    first.type = logicManager.dao.script;

    await expect(
      sdk.completeTransaction(tx, { signer, feeRate: 1_000n, cells: [source] }),
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
      }),
    ).rejects.toBe(failure);
  });
}

/** A transaction whose plain outputs fill the size budget up to `room` bytes. */
function fullBudgetTransaction(lock: ccc.Script, room = 0): ccc.Transaction {
  const tx = ccc.Transaction.default();
  const empty = tx.toBytes().length;
  tx.addOutput({ capacity: ccc.fixedPointFrom(61), lock }, "0x");
  const perOutput = tx.toBytes().length - empty;
  const outputCount = Math.ceil((TRANSACTION_SIZE_BUDGET - room - empty) / perOutput);
  for (let index = 1; index < outputCount; index += 1) {
    tx.addOutput({ capacity: ccc.fixedPointFrom(61), lock }, "0x");
  }
  return tx;
}

function plainCell(byte: string, lock: ccc.Script, capacity: ccc.Num): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: { capacity, lock },
    outputData: "0x",
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
