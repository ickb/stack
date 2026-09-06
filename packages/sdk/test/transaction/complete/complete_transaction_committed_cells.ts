import { ccc } from "@ckb-ccc/core";
import { script, StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { DaoOutputLimitError } from "../../../src/dao/index.ts";
import { defaultCellPageSize } from "../../../src/utils/index.ts";
import {
  fundedSigner,
  testSdk,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { hash, transactionWithOutputs } from "../base/support/sdk_core_support.ts";
import { COMPLETE_TRANSACTION_SUITE } from "./support/sdk_suite_titles.ts";

describe(COMPLETE_TRANSACTION_SUITE, () => {
  registerCompletionSuccessTests();
  registerCompletionFailureTests();
  registerCompletionErrorPropagationTests();
});

function registerCompletionSuccessTests(): void {
  it("selects committed plain cells and creates exact plain change", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const source = plainCell("81", lock, ccc.fixedPointFrom(200));
    const { client, signer } = fundedSigner([source], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(40), lock }, "0x");
    const feeRate = 1_000n;

    const completed = await sdk.completeTransaction(tx, { signer, feeRate });

    expect(completed.inputs).toHaveLength(1);
    expect(completed.inputs[0]?.previousOutput.eq(source.outPoint)).toBe(true);
    expect(completed.outputs).toHaveLength(2);
    const change = Array.from(completed.outputCells)[1];
    expect(change?.cellOutput.lock.eq(lock)).toBe(true);
    expect(change?.cellOutput.type).toBeUndefined();
    expect(change?.outputData).toBe("0x");
    await expect(completed.getFee(client)).resolves.toBe(completed.estimateFee(feeRate));
  });

  it("collects across generic signer locks and changes to the recommended lock", async () => {
    const { sdk } = testSdk({ completion: "real" });
    const recommended = script("11");
    const secondary = script("12");
    const left = plainCell("82", recommended, ccc.fixedPointFrom(200));
    const right = plainCell("83", secondary, ccc.fixedPointFrom(200));
    const { signer } = fundedSigner([left, right], [recommended, secondary]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(250), lock: recommended }, "0x");

    const completed = await sdk.completeTransaction(tx, { signer, feeRate: 1_000n });

    expect(completed.inputs.map((input) => input.previousOutput.toHex())).toEqual([
      left.outPoint.toHex(),
      right.outPoint.toHex(),
    ]);
    expect(
      Array.from(completed.outputCells).at(-1)?.cellOutput.lock.eq(recommended),
    ).toBe(true);
  });

  it("does not add a caller-supplied input twice when it reappears in the scan", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const existing = plainCell("87", lock, ccc.fixedPointFrom(200));
    const additional = plainCell("88", lock, ccc.fixedPointFrom(200));
    const { signer } = fundedSigner([existing, additional], [lock]);
    const tx = ccc.Transaction.default();
    tx.addInput(existing);
    tx.addOutput({ capacity: ccc.fixedPointFrom(250), lock }, "0x");

    const completed = await sdk.completeTransaction(tx, { signer, feeRate: 1_000n });

    expect(completed.inputs.map((input) => input.previousOutput.toHex())).toEqual([
      existing.outPoint.toHex(),
      additional.outPoint.toHex(),
    ]);
  });
}

function registerCompletionFailureTests(): void {
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
    const originalCapacity = tx.outputs[0]?.capacity;

    await expect(
      sdk.completeTransaction(tx, { signer, feeRate: 1_000n }),
    ).rejects.toMatchObject({
      name: "IckbError",
      code: "insufficient_capacity",
      retryable: false,
    });
    expect(tx.toHex()).toBe(original);
    expect(tx.outputs[0]?.capacity).toBe(originalCapacity);
  });

  it("does not reinterpret a pre-existing plain output as fee change", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const source = plainCell("89", lock, ccc.fixedPointFrom(50));
    const { signer } = fundedSigner([source], [lock]);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(40), lock }, "0x");
    const original = tx.toHex();

    await expect(
      sdk.completeTransaction(tx, { signer, feeRate: 1_000n }),
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
    first.type = logicManager.daoManager.script;

    await expect(
      sdk.completeTransaction(tx, { signer, feeRate: 1_000n }),
    ).rejects.toBeInstanceOf(DaoOutputLimitError);
    expect(tx.outputs).toHaveLength(64);
  });

  it("maps a committed-cell examination overflow without using partial results", async () => {
    const { sdk, logicManager, lock } = testSdk({ completion: "real" });
    const foreign = plainCell("86", lock, ccc.fixedPointFrom(100));
    foreign.cellOutput.type = logicManager.script;
    const client = new StubClient();
    let cursor = 0;
    client.findCellsPagedNoCache = async (
      _key,
      _order,
      limit,
    ): ReturnType<ccc.Client["findCellsPagedNoCache"]> => {
      await Promise.resolve();
      cursor += 1;
      return {
        cells: Array.from({ length: Number(limit) }, () => foreign),
        lastCursor: `page:${String(cursor)}`,
      };
    };
    const signer = new ccc.SignerCkbScriptReadonly(client, lock);
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(40), lock }, "0x");

    await expect(
      sdk.completeTransaction(tx, { signer, feeRate: 1_000n }),
    ).rejects.toMatchObject({ code: "account_scan_limit" });
    expect(cursor).toBe(Math.floor(6_400 / defaultCellPageSize) + 1);
  });
}

function registerCompletionErrorPropagationTests(): void {
  it("preserves non-capacity failures from signer preparation", async () => {
    const { sdk, lock } = testSdk({ completion: "real" });
    const failure = new Error("wallet preparation failed");
    const signer = new RejectingPrepareSigner(new StubClient(), lock, failure);

    await expect(
      sdk.completeTransaction(ccc.Transaction.default(), {
        signer,
        feeRate: 1_000n,
      }),
    ).rejects.toBe(failure);
  });
}

function plainCell(byte: string, lock: ccc.Script, capacity: ccc.Num): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: { capacity, lock },
    outputData: "0x",
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
