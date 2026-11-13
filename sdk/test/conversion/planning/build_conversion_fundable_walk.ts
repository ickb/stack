import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConversionTransaction } from "../../../src/build.ts";
import * as completion from "../../../src/complete.ts";
import {
  completeFirstFundable,
  type CompleteTransactionResult,
} from "../../../src/complete.ts";
import { ICKB_UDT } from "../../../src/constants.ts";
import {
  MAX_OFFERED_ICKB_CELLS,
  MAX_OFFERED_PLAIN_CELLS,
  projectState,
} from "../../../src/conversion/projection.ts";
import { DAO_OUTPUT_LIMIT } from "../../../src/dao.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import {
  baseTip,
  state,
  transactionWithOutputs,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  baseTransactionFixture,
  fundedSigner,
  type BaseTransactionFixture,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import {
  depositCell,
  nativeUdtCell,
  plainCapacityCell,
} from "../withdrawal_quotes/support/sdk_cell_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const ICKB_TO_CKB = "ickb-to-ckb";
// Typed unknown so the matcher's `any` stays out of the asserted object.
const capacityError: unknown = expect.any(ccc.ErrorTransactionInsufficientCapacity);
const INSUFFICIENT_CAPACITY = {
  ok: false,
  reason: "insufficient-capacity",
  cause: capacityError,
};
const DEPOSIT = ICKB_DEPOSIT_CAP;
// Measured with the real builders: one owner marker for the fixture lock, and the
// remainder order's two cells.
const MARKER_CKB = ccc.fixedPointFrom(78);
const ORDER_CKB = ccc.fixedPointFrom(199 + 74);
const MIN_CHANGE_CKB = ccc.fixedPointFrom(61);
const UDT_CELL_CKB = ccc.fixedPointFrom(146);

/** How many of the transaction's outputs carry `type`. */
function outputsTyped(tx: ccc.Transaction, type: ccc.Script): number {
  return tx.outputs.filter((output) => output.type?.eq(type) === true).length;
}

/** Three ready deposits in one ring segment: one anchor and two surplus. */
function readyPool(
  fixture: BaseTransactionFixture,
): Array<ReturnType<typeof depositCell>> {
  return ["a1", "a2", "a3"].map((byte) =>
    depositCell(byte, fixture.logic, fixture.dao, baseTip, baseTip, { isReady: true }),
  );
}

function conversion(
  fixture: BaseTransactionFixture,
  amount: bigint,
  userCkb: bigint,
): Parameters<typeof buildConversionTransaction> {
  const lock = fixture.botLock;
  // The user's iCKB sits in one minimum-capacity cell; its capacity is taken off the
  // plain cell so the CKB arithmetic below stays the measured one.
  const cells = [
    plainCapacityCell(userCkb - UDT_CELL_CKB, lock, "f1"),
    nativeUdtCell(amount, {
      lock,
      capacity: UDT_CELL_CKB,
      byte: "f0",
    }),
  ];
  return [
    fundedSigner(cells, [lock]).signer,
    state({
      poolDeposits: readyPool(fixture),
      cells,
      ickbAvailable: amount,
    }),
    ICKB_TO_CKB,
    amount,
  ];
}

describe("buildConversionTransaction fundable walk", () => {
  it("spends one transaction's share of an account with thousands of cells", async () => {
    const lock = script("11");
    const plain = Array.from({ length: 1000 }, () =>
      plainCapacityCell(ccc.fixedPointFrom(100), lock),
    );
    // Empty iCKB cells a third party sent, beside the one holding the account's iCKB.
    const ickb = [
      nativeUdtCell(ICKB_DEPOSIT_CAP, { lock, capacity: UDT_CELL_CKB }),
      ...Array.from({ length: 2000 }, () =>
        nativeUdtCell(0n, { lock, capacity: UDT_CELL_CKB }),
      ),
    ];
    const account = projectState(
      state(),
      { capacityCells: plain, nativeUdtCells: ickb, receipts: [], withdrawalGroups: [] },
      [],
      lock,
    );

    const result = await buildConversionTransaction(
      fundedSigner([], [lock]).signer,
      account,
      "ckb-to-ickb",
      account.ckbConvertible,
    );

    if (!result.ok) {
      throw new Error(result.reason);
    }
    // The Max converts in one transaction of the shares alone, within the 2,048 inputs.
    expect(result.tx.inputs).toHaveLength(
      MAX_OFFERED_PLAIN_CELLS + MAX_OFFERED_ICKB_CELLS,
    );
    expect(result.tx.getOutputsUdtBalance(ICKB_UDT)).toBe(ICKB_DEPOSIT_CAP);
  });

  it("walks down the greedy prefixes until the real completer can fund one", async () => {
    const fixture = baseTransactionFixture();
    // Two markers plus the order do not fit; one marker plus the rebuilt, larger order does.
    const userCkb = MARKER_CKB + ORDER_CKB + MIN_CHANGE_CKB + ccc.fixedPointFrom(4);

    const result = await buildConversionTransaction(
      ...conversion(fixture, 2n * DEPOSIT + DEPOSIT / 2n, userCkb),
    );

    // Completion spends both offered liquid cells.
    expect(result).toMatchObject({
      ok: true,
      conversionKind: "direct-plus-order",
      orderOccupiedCapacity: ORDER_CKB,
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    const daoOutputs = result.tx.outputs.filter(
      (output) => output.type?.eq(fixture.dao) === true,
    );
    expect(daoOutputs).toHaveLength(1);
    expect(result.tx.outputs).toHaveLength(5);
    // The walk returns the fee of the candidate it settled on, not of a dropped one.
    expect(result.plannedFee).toBe(result.tx.estimateFee(state().feeRate));
  });

  it("reports the order cells' occupied capacity apart from the CKB they convert", async () => {
    const fixture = baseTransactionFixture();
    const lock = fixture.botLock;
    const amount = ccc.fixedPointFrom(1000);
    const cells = [
      plainCapacityCell(
        amount + ORDER_CKB + MIN_CHANGE_CKB + ccc.fixedPointFrom(1),
        lock,
        "f3",
      ),
    ];

    const result = await buildConversionTransaction(
      fundedSigner(cells, [lock]).signer,
      state({ cells, ckbAvailable: amount }),
      "ckb-to-ickb",
      amount,
    );

    // The order cell holds the 1,000 CKB as well; only the cell space is reported.
    expect(result).toMatchObject({
      ok: true,
      conversionKind: "order",
      orderOccupiedCapacity: ORDER_CKB,
    });
  });

  it("returns the last shortfall when no CKB-to-iCKB candidate can be funded", async () => {
    const fixture = baseTransactionFixture();
    const lock = fixture.botLock;
    const cells = [plainCapacityCell(ccc.fixedPointFrom(1), lock, "f2")];

    await expect(
      buildConversionTransaction(
        fundedSigner(cells, [lock]).signer,
        state({
          cells,
          ckbAvailable: DEPOSIT,
        }),
        "ckb-to-ickb",
        DEPOSIT,
      ),
    ).resolves.toEqual(INSUFFICIENT_CAPACITY);
  });

  it("returns the last shortfall when no candidate can be funded", async () => {
    const fixture = baseTransactionFixture();

    await expect(
      buildConversionTransaction(
        ...conversion(fixture, 2n * DEPOSIT + DEPOSIT / 2n, ccc.fixedPointFrom(100)),
      ),
    ).resolves.toEqual(INSUFFICIENT_CAPACITY);
  });

  it("completes the most deposits a conversion holds at the first plan", async () => {
    // Sixty deposits, their receipt, the remainder order's two cells and the change: 64.
    const fixture = baseTransactionFixture();
    const lock = fixture.botLock;
    const amount = 64n * DEPOSIT;
    const cells = [plainCapacityCell(amount + ccc.fixedPointFrom(100_000), lock, "f4")];
    const completions = vi.spyOn(completion, "completeTransaction");

    const result = await buildConversionTransaction(
      fundedSigner(cells, [lock]).signer,
      state({ cells, ckbAvailable: amount }),
      "ckb-to-ickb",
      amount,
    );

    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect({
      deposits: outputsTyped(result.tx, fixture.dao),
      outputs: result.tx.outputs.length,
      completions: completions.mock.calls.length,
    }).toEqual({ deposits: 60, outputs: DAO_OUTPUT_LIMIT, completions: 1 });
  });

  it("steps plans over the DAO output limit down to one that fits", async () => {
    // An iCKB cell beside the CKB leaves an iCKB change output too: 65 outputs at sixty
    // deposits, so the walk steps down one.
    const fixture = baseTransactionFixture();
    const lock = fixture.botLock;
    const amount = 64n * DEPOSIT;
    const cells = [
      plainCapacityCell(amount + ccc.fixedPointFrom(100_000), lock, "f4"),
      nativeUdtCell(DEPOSIT, { lock, capacity: UDT_CELL_CKB, byte: "f5" }),
    ];

    const result = await buildConversionTransaction(
      fundedSigner(cells, [lock]).signer,
      state({ cells, ckbAvailable: amount }),
      "ckb-to-ickb",
      amount,
    );

    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(outputsTyped(result.tx, fixture.dao)).toBe(59);
    expect(result.tx.outputs).toHaveLength(DAO_OUTPUT_LIMIT);
    expect(result.conversionKind).toBe("direct-plus-order");
  });

  it("completes the most withdrawal requests a conversion holds at the first plan", async () => {
    // Thirty requests and their owner markers, the remainder order's two cells, the CKB
    // change and the iCKB change: 64.
    const fixture = baseTransactionFixture();
    const lock = fixture.botLock;
    // One anchor and the rest surplus, all in one ring segment, more than one plan holds.
    const pool = Array.from({ length: 40 }, (_, index) =>
      depositCell(
        (0x40 + index).toString(16),
        fixture.logic,
        fixture.dao,
        baseTip,
        baseTip,
        { isReady: true },
      ),
    );
    const amount = 35n * DEPOSIT;
    const cells = [
      plainCapacityCell(ccc.fixedPointFrom(100_000), lock, "f6"),
      nativeUdtCell(amount + 1n, { lock, capacity: UDT_CELL_CKB, byte: "f7" }),
    ];
    const completions = vi.spyOn(completion, "completeTransaction");

    const result = await buildConversionTransaction(
      fundedSigner(cells, [lock]).signer,
      state({ poolDeposits: pool, cells, ickbAvailable: amount + 1n }),
      ICKB_TO_CKB,
      amount,
    );

    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect({
      requests: outputsTyped(result.tx, fixture.dao),
      outputs: result.tx.outputs.length,
      completions: completions.mock.calls.length,
    }).toEqual({ requests: 30, outputs: DAO_OUTPUT_LIMIT, completions: 1 });
  });
});

describe("completeFirstFundable", () => {
  const tx = ccc.Transaction.default();

  it("advances past completion failures and returns the last one", async () => {
    const attempts: number[] = [];
    const complete = async (
      candidate: ccc.Transaction,
    ): Promise<CompleteTransactionResult> => {
      await Promise.resolve();
      if (candidate.outputs.length === 3) {
        return { ok: false, reason: "dao-output-limit" };
      }
      return { ok: true, tx: candidate, plannedFee: 0n };
    };

    const funded = await completeFirstFundable(
      [3, 2, 1],
      (count) => {
        attempts.push(count);
        return transactionWithOutputs(count, script("11"));
      },
      complete,
    );

    expect(attempts).toEqual([3, 2]);
    expect(funded).toMatchObject({ candidate: 2 });
    await expect(
      completeFirstFundable([3], () => transactionWithOutputs(3, script("11")), complete),
    ).resolves.toEqual({ ok: false, reason: "dao-output-limit" });
    await expect(completeFirstFundable([], () => tx, complete)).rejects.toThrow(
      "No candidate could be completed",
    );
  });

  it("propagates what the completion throws", async () => {
    await expect(
      completeFirstFundable(
        [1],
        () => tx,
        async () => {
          await Promise.resolve();
          throw new TypeError("fetch failed");
        },
      ),
    ).rejects.toThrow("fetch failed");
  });
});
