import { ccc } from "@ckb-ccc/core";
import { IckbError } from "../../../../src/conversion/sdk_error.ts";
import { ICKB_DEPOSIT_CAP } from "../../../../src/core/index.ts";
import { OrderManager } from "../../../../src/order/index.ts";

import { afterEach, describe, expect, it, vi } from "vitest";
import { ICKB_WITHDRAW_ABOVE } from "../../../src/bot/policy/constants.ts";
import { buildTransaction } from "../../../src/bot/runtime/transaction.ts";
import type { Runtime } from "../../../src/bot/runtime/types.ts";
import {
  botRuntime,
  botState,
  completeSearchResult,
  readyDeposit,
} from "../fixtures/bot.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const MINUTE = 60n * 1000n;
const RICH_CKB = ccc.fixedPointFrom(500_000);

function noMatch(): void {
  vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
    completeSearchResult({ ckbDelta: 0n, udtDelta: 0n, partials: [] }),
  );
}

/** Completion that leaves `change` plain CKB with the bot. */
function completing(change: bigint): Runtime["completeTransaction"] {
  return async (txLike): Promise<ccc.Transaction> => {
    await Promise.resolve();
    const tx = ccc.Transaction.from(txLike).clone();
    tx.addOutput({ capacity: change, lock: botRuntime().primaryLock }, "0x");
    return tx;
  };
}

describe("buildTransaction deposit", () => {
  it("deposits one cap-sized deposit when iCKB is under the refill line", async () => {
    noMatch();
    const runtime = botRuntime({
      completeTransaction: completing(ccc.fixedPointFrom(2000)),
    });
    const deposit = vi.spyOn(runtime.managers.logic, "deposit");

    const result = await buildTransaction(
      runtime,
      botState({ ckb: RICH_CKB, ickb: 0n, depositCapacity: ccc.fixedPointFrom(1100) }),
    );

    expect(deposit).toHaveBeenCalledWith(
      expect.anything(),
      1,
      ccc.fixedPointFrom(1100),
      runtime.primaryLock,
    );
    expect(result).toMatchObject({
      kind: "built",
      actions: { deposits: 1 },
      decision: {
        rebalance: { deposit: "low_ickb", ring: { poolDepositCount: 0 } },
        core: { kind: "deposit", attempts: 1 },
      },
    });
  });

  it("rejects a deposit that would leave less than the reserve in plain CKB", async () => {
    noMatch();
    const runtime = botRuntime({
      completeTransaction: completing(ccc.fixedPointFrom(999)),
    });

    const result = await buildTransaction(
      runtime,
      botState({ ckb: RICH_CKB, ickb: 0n, depositCapacity: ccc.fixedPointFrom(1100) }),
    );

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "no_fundable_candidate",
      decision: { core: { kind: "none", attempts: 1 } },
    });
  });

  it("falls through to the withdrawal when the seed deposit cannot complete", async () => {
    noMatch();
    // An under-covered tip window with one ready surplus deposit, and excess iCKB.
    const surplus = readyDeposit("71", ICKB_DEPOSIT_CAP, 0n);
    const anchor = readyDeposit("72", ICKB_DEPOSIT_CAP + 1n, 0n);
    const whale = readyDeposit("73", 30n * ICKB_DEPOSIT_CAP, 60n * MINUTE);
    const daoScript = botRuntime().managers.dao.script;
    const primaryLock = botRuntime().primaryLock;
    const completeTransaction = vi.fn(async (txLike: ccc.TransactionLike) => {
      await Promise.resolve();
      const tx = ccc.Transaction.from(txLike).clone();
      const isDeposit = (output: ccc.CellOutput): boolean =>
        output.type?.eq(daoScript) === true &&
        output.capacity === ccc.fixedPointFrom(100_000);
      if (tx.outputs.some(isDeposit)) {
        throw new IckbError("no CKB for the deposit", { code: "insufficient_capacity" });
      }
      tx.addOutput({ capacity: ccc.fixedPointFrom(2000), lock: primaryLock }, "0x");
      return tx;
    });
    const runtime = botRuntime({ completeTransaction });

    const result = await buildTransaction(
      runtime,
      botState({
        ckb: RICH_CKB,
        ickb: ICKB_WITHDRAW_ABOVE + 1n,
        poolDeposits: [surplus, anchor, whale],
      }),
    );

    expect(completeTransaction).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      kind: "built",
      actions: { deposits: 0, withdrawalRequests: 1 },
      decision: {
        rebalance: { deposit: "ring_coverage", withdrawal: { candidateCount: 1 } },
        core: { kind: "withdraw", withdrawalRequests: 1, attempts: 2 },
      },
    });
  });
});
