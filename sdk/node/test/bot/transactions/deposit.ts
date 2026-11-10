import { ccc } from "@ckb-ccc/core";
import { DAO, ICKB_LOGIC } from "../../../../src/constants.ts";
import { receiptPhase2Capacity } from "../../../../src/logic.ts";
import { IckbError } from "../../../../src/sdk.ts";
import { ICKB_DEPOSIT_CAP } from "../../../../src/udt.ts";

import { afterEach, describe, expect, it, vi } from "vitest";
import { ICKB_REFILL_BELOW, ICKB_WITHDRAW_ABOVE } from "../../../src/bot/policy.ts";
import { buildTransaction } from "../../../src/bot/transaction.ts";
import { CKB_RESERVE } from "../../../src/shared/reserve.ts";
import {
  botRuntime,
  botState,
  botSystem,
  marketOrder,
  PLANNED_FEE,
  readyDeposit,
} from "../fixtures/bot.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const RICH_CKB = ccc.fixedPointFrom(500_000);

describe("buildTransaction deposit", () => {
  it("deposits one cap-sized deposit when iCKB is under the refill line", async () => {
    const runtime = botRuntime();

    const result = await buildTransaction(
      runtime,
      botState({
        ckbAvailable: RICH_CKB,
        ickbAvailable: 0n,
        system: { ...botSystem(), depositCapacity: ccc.fixedPointFrom(1100) },
      }),
    );

    if (result.kind !== "built") {
      throw new Error("Expected a built transaction");
    }
    // One deposit of the state's capacity, its receipt at the primary lock, then change.
    const [depositOutput, receipt] = result.tx.outputs;
    expect(depositOutput?.capacity).toBe(ccc.fixedPointFrom(1100));
    expect(depositOutput?.lock.eq(ICKB_LOGIC)).toBe(true);
    expect(depositOutput?.type?.eq(DAO)).toBe(true);
    expect(receipt?.lock.eq(runtime.primaryLock)).toBe(true);
    expect(receipt?.type?.eq(ICKB_LOGIC)).toBe(true);
    expect(result.tx.outputs).toHaveLength(3);
    expect(result).toMatchObject({
      kind: "built",
      decision: {
        actions: { deposits: 1 },
        rebalance: { deposit: "low_ickb", ring: { poolDepositCount: 0 } },
        core: { kind: "deposit", attempts: 1 },
      },
    });
  });

  it("plans the refill on the balances the match leaves, the receipt in its cost", async () => {
    // The buyer takes 100 iCKB for 200 CKB: the refill line is crossed only after the match,
    // and the deposit with its receipt is affordable only with the CKB the match brings.
    const runtime = botRuntime();
    const depositCapacity = ccc.fixedPointFrom(1100);
    const cost = depositCapacity + receiptPhase2Capacity(runtime.primaryLock);
    const buyer = marketOrder({
      byte: "74",
      ckb: ccc.fixedPointFrom(200),
      udt: 0n,
      ratio: { ckbScale: 1n, udtScale: 2n },
    });
    const deposit = async (ckbAfterMatch: bigint): Promise<unknown> =>
      (
        await buildTransaction(
          runtime,
          botState({
            orderPool: [buyer],
            ckbAvailable: ckbAfterMatch - ccc.fixedPointFrom(200),
            ickbAvailable: ICKB_REFILL_BELOW + ccc.fixedPointFrom(50),
            system: { ...botSystem(), depositCapacity },
          }),
        )
      ).decision.rebalance.deposit;

    await expect(deposit(CKB_RESERVE + cost)).resolves.toBe("low_ickb");
    await expect(deposit(CKB_RESERVE + cost - 1n)).resolves.toBeUndefined();
  });

  it("falls through to the withdrawal when the seed deposit cannot complete", async () => {
    // An under-covered tip window with one ready surplus deposit, and excess iCKB:
    // 31.5 caps make 16 segments, and the half cap at the tip holds under half its share.
    const surplus = readyDeposit("71", ICKB_DEPOSIT_CAP / 4n);
    const anchor = readyDeposit("72", ICKB_DEPOSIT_CAP / 4n + 1n);
    // Sixty epochs out: another ring segment.
    const whale = readyDeposit("73", 31n * ICKB_DEPOSIT_CAP, 60n * 240n);
    const primaryLock = botRuntime().primaryLock;
    const completeTransaction = vi.fn(async (txLike: ccc.TransactionLike) => {
      await Promise.resolve();
      const tx = ccc.Transaction.from(txLike).clone();
      const isDeposit = (output: ccc.CellOutput): boolean =>
        output.type?.eq(DAO) === true && output.capacity === ccc.fixedPointFrom(100_000);
      if (tx.outputs.some(isDeposit)) {
        throw new IckbError("no CKB for the deposit", { code: "insufficient_capacity" });
      }
      tx.addOutput({ capacity: ccc.fixedPointFrom(2000), lock: primaryLock }, "0x");
      return { tx, plannedFee: PLANNED_FEE };
    });
    const runtime = botRuntime({ completeTransaction });

    const result = await buildTransaction(
      runtime,
      botState({
        ckbAvailable: RICH_CKB,
        ickbAvailable: ICKB_WITHDRAW_ABOVE + 1n,
        poolDeposits: [surplus, anchor, whale],
      }),
    );

    expect(completeTransaction).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      kind: "built",
      decision: {
        actions: { deposits: 0, withdrawalRequests: 1 },
        rebalance: { deposit: "ring_coverage", withdrawal: { candidateCount: 1 } },
        core: { kind: "withdraw", attempts: 2 },
      },
    });
  });
});
