import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeFirstFundable } from "../../../src/conversion/fundable_walk.ts";
import {
  DAO_HEADER_INDEX_LIMIT,
  DaoHeaderIndexError,
  DaoOutputLimitError,
} from "../../../src/dao.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import {
  baseTip,
  conversionContext,
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
const DEPOSIT = ICKB_DEPOSIT_CAP;
// Measured with the real managers: one owner marker for the fixture lock, and the
// remainder order's two cells.
const MARKER_CKB = ccc.fixedPointFrom(78);
const ORDER_CKB = ccc.fixedPointFrom(163 + 74);
const MIN_CHANGE_CKB = ccc.fixedPointFrom(61);
const UDT_CELL_CKB = ccc.fixedPointFrom(146);

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
  fundingCells: ccc.Cell[] = [],
): Parameters<BaseTransactionFixture["sdk"]["buildConversionTransaction"]>[1] {
  const lock = fixture.botLock;
  // The user's iCKB sits in one minimum-capacity cell; its capacity is taken off the
  // plain cell so the CKB arithmetic below stays the measured one.
  const cells = [
    plainCapacityCell(userCkb - UDT_CELL_CKB, lock, "f1"),
    nativeUdtCell(amount, {
      lock,
      type: fixture.udt,
      capacity: UDT_CELL_CKB,
      byte: "f0",
    }),
    ...fundingCells,
  ];
  return {
    direction: ICKB_TO_CKB,
    amount,
    lock,
    signer: fundedSigner(cells, [lock]).signer,
    context: conversionContext({
      system: {
        ckbAvailable: ccc.fixedPointFrom(1_000_000),
        poolDeposits: readyPool(fixture),
      },
      cells,
      ickbAvailable: amount,
    }),
  };
}

describe("buildConversionTransaction fundable walk", () => {
  it("walks down the greedy prefixes until the real completer can fund one", async () => {
    const fixture = baseTransactionFixture({ completion: "real" });
    // Two markers plus the order do not fit; one marker plus the rebuilt, larger order does.
    const userCkb = MARKER_CKB + ORDER_CKB + MIN_CHANGE_CKB + ccc.fixedPointFrom(4);

    const result = await fixture.sdk.buildConversionTransaction(
      ccc.Transaction.default(),
      conversion(fixture, 2n * DEPOSIT + DEPOSIT / 2n, userCkb),
    );

    expect(result).toMatchObject({ ok: true, conversion: { kind: "direct-plus-order" } });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    const daoOutputs = result.tx.outputs.filter(
      (output) => output.type?.eq(fixture.dao) === true,
    );
    expect(daoOutputs).toHaveLength(1);
    expect(result.tx.outputs).toHaveLength(5);
  });

  it("falls back to the whole-request order when every direct prefix exceeds the DAO output limit", async () => {
    const fixture = baseTransactionFixture({ completion: "real" });
    // A DAO withdrawal request keeps input and output positions aligned, so the crowded
    // base transaction moves sixty plain cells.
    const cells = Array.from({ length: 60 }, (_, index) =>
      plainCapacityCell(
        ccc.fixedPointFrom(100),
        fixture.botLock,
        (0x10 + index).toString(16),
      ),
    );
    const baseTx = ccc.Transaction.default();
    for (const cell of cells) {
      baseTx.addInput(cell);
      baseTx.addOutput(cell.cellOutput, cell.outputData);
    }

    const result = await fixture.sdk.buildConversionTransaction(
      baseTx,
      conversion(fixture, 2n * DEPOSIT, ccc.fixedPointFrom(100_000), cells),
    );

    // 60 base outputs leave no room for two requests and their markers plus change, nor
    // for one request, its marker, and the order; the order alone fits.
    expect(result).toMatchObject({ ok: true, conversion: { kind: "order" } });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.tx.outputs).toHaveLength(63);
  });

  it("throws the last completion failure when no CKB-to-iCKB candidate can be funded", async () => {
    const fixture = baseTransactionFixture({ completion: "real" });
    const lock = fixture.botLock;
    const cells = [plainCapacityCell(ccc.fixedPointFrom(1), lock, "f2")];

    await expect(
      fixture.sdk.buildConversionTransaction(ccc.Transaction.default(), {
        direction: "ckb-to-ickb",
        amount: DEPOSIT,
        lock,
        signer: fundedSigner(cells, [lock]).signer,
        context: conversionContext({
          system: { ckbAvailable: ccc.fixedPointFrom(1_000_000) },
          cells,
          ckbAvailable: DEPOSIT,
        }),
      }),
    ).rejects.toMatchObject({ name: "IckbError", code: "insufficient_capacity" });
  });

  it("throws the last completion failure when no candidate can be funded", async () => {
    const fixture = baseTransactionFixture({ completion: "real" });

    await expect(
      fixture.sdk.buildConversionTransaction(
        ccc.Transaction.default(),
        conversion(fixture, 2n * DEPOSIT + DEPOSIT / 2n, ccc.fixedPointFrom(100)),
      ),
    ).rejects.toMatchObject({ name: "IckbError", code: "insufficient_capacity" });
  });
});

describe("completeFirstFundable", () => {
  const tx = ccc.Transaction.default();

  it("advances past fundability failures and keeps the last error", async () => {
    const attempts: number[] = [];
    const complete = async (candidate: ccc.Transaction): Promise<ccc.Transaction> => {
      await Promise.resolve();
      if (candidate.outputs.length === 3) {
        throw new DaoOutputLimitError(65);
      }
      return candidate;
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
    ).rejects.toMatchObject({ name: "DaoOutputLimitError" });
    await expect(completeFirstFundable([], () => tx, complete)).rejects.toThrow(
      "No candidate could be completed",
    );
  });

  it("advances past a deposit-header overflow thrown by the builder", async () => {
    // The DAO builder throws while building, before completion; the walk treats it like
    // any other fundability failure and tries the next candidate.
    const funded = await completeFirstFundable(
      [2, 1],
      (count) => {
        if (count === 2) {
          throw new DaoHeaderIndexError(DAO_HEADER_INDEX_LIMIT);
        }
        return transactionWithOutputs(count, script("11"));
      },
      async (candidate) => {
        await Promise.resolve();
        return candidate;
      },
    );

    expect(funded).toMatchObject({ candidate: 1 });
  });

  it("propagates failures that are not about fundability", async () => {
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
