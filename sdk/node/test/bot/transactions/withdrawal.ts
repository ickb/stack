import { ccc } from "@ckb-ccc/core";
import { IckbError } from "../../../../src/conversion/sdk_error.ts";
import { ICKB_DEPOSIT_CAP, type IckbDepositCell } from "../../../../src/core/index.ts";
import { OrderManager } from "../../../../src/order/index.ts";

import { afterEach, describe, expect, it, vi } from "vitest";
import { ICKB_RETAIN, ICKB_WITHDRAW_ABOVE } from "../../../src/bot/policy/constants.ts";
import { buildTransaction } from "../../../src/bot/runtime/transaction.ts";
import type { Runtime } from "../../../src/bot/runtime/types.ts";
import {
  botRuntime,
  botState,
  completeSearchResult,
  FUNDED_CHANGE,
  readyDeposit,
  testWithdrawal,
} from "../fixtures/bot.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const MINUTE = 60n * 1000n;

function noMatch(): void {
  vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
    completeSearchResult({ ckbDelta: 0n, udtDelta: 0n, partials: [] }),
  );
}

/** Completion that funds every core carrying at most `maxRequests` withdrawal requests. */
function completingUpTo(maxRequests: number): Runtime["completeTransaction"] {
  const daoScript = botRuntime().managers.dao.script;
  return async (txLike): Promise<ccc.Transaction> => {
    await Promise.resolve();
    const tx = ccc.Transaction.from(txLike).clone();
    const requests = tx.outputs.filter((output) => output.type?.eq(daoScript) === true);
    if (requests.length > maxRequests) {
      throw new IckbError("too many markers", { code: "insufficient_capacity" });
    }
    if (requests.length === 0) {
      tx.addOutput({ capacity: FUNDED_CHANGE, lock: botRuntime().primaryLock }, "0x");
    }
    return tx;
  };
}

/** Surplus deposits in one covered ring: an anchor per window plus these extras. */
function pool(extras: IckbDepositCell[]): IckbDepositCell[] {
  return [readyDeposit("a0", ICKB_DEPOSIT_CAP + 1n, 0n), ...extras];
}

describe("buildTransaction withdrawal", () => {
  it("requests the longest fundable prefix of the surplus chain, oldest first", async () => {
    noMatch();
    const first = readyDeposit("81", 4n, 0n);
    const second = readyDeposit("82", 6n, 5n * MINUTE);
    const third = readyDeposit("83", 5n, 10n * MINUTE);
    const completeTransaction = completingUpTo(2);
    const runtime = botRuntime({ completeTransaction });
    const requestWithdrawal = vi.spyOn(runtime.managers.ownedOwner, "requestWithdrawal");

    const result = await buildTransaction(
      runtime,
      botState({
        ckb: ccc.fixedPointFrom(500_000),
        ickb: ICKB_WITHDRAW_ABOVE + 100n,
        poolDeposits: pool([third, first, second]),
      }),
    );

    expect(requestWithdrawal.mock.lastCall?.[1]).toEqual([first, second]);
    expect(result).toMatchObject({
      kind: "built",
      actions: { withdrawalRequests: 2 },
      decision: {
        rebalance: { withdrawal: { candidateCount: 3, stress: false } },
        core: { kind: "withdraw", withdrawalRequests: 2, attempts: 2 },
      },
    });
  });

  it("rebuilds the chain from the next oldest deposit when the first chain cannot complete", async () => {
    noMatch();
    const big = readyDeposit("84", ICKB_DEPOSIT_CAP, 0n);
    const small = readyDeposit("85", ICKB_DEPOSIT_CAP / 2n, 5n * MINUTE);
    const completeTransaction = vi.fn(async (txLike: ccc.TransactionLike) => {
      await Promise.resolve();
      const tx = ccc.Transaction.from(txLike).clone();
      if (tx.inputs.some((input) => input.previousOutput.eq(big.cell.outPoint))) {
        throw new IckbError("the big deposit does not fit", {
          code: "insufficient_capacity",
        });
      }
      return tx;
    });
    const runtime = botRuntime({ completeTransaction });
    const requestWithdrawal = vi.spyOn(runtime.managers.ownedOwner, "requestWithdrawal");
    // Budget takes the big deposit alone; the small one only fits once the big one is dropped.
    const ickb = ICKB_RETAIN + ICKB_DEPOSIT_CAP + ICKB_DEPOSIT_CAP / 4n;

    const result = await buildTransaction(
      runtime,
      botState({
        ckb: ccc.fixedPointFrom(500_000),
        ickb,
        poolDeposits: pool([big, small]),
      }),
    );

    expect(requestWithdrawal.mock.lastCall?.[1]).toEqual([small]);
    expect(result).toMatchObject({
      kind: "built",
      decision: { core: { kind: "withdraw", withdrawalRequests: 1, attempts: 2 } },
    });
  });

  it("accepts a withdrawal that leaves no plain reserve, since it brings CKB back", async () => {
    noMatch();
    const only = readyDeposit("86", 4n, 0n);
    const runtime = botRuntime({ completeTransaction: completingUpTo(1) });

    const result = await buildTransaction(
      runtime,
      botState({
        ckb: ccc.fixedPointFrom(1500),
        ickb: ICKB_WITHDRAW_ABOVE + 100n,
        poolDeposits: pool([only]),
      }),
    );

    expect(result).toMatchObject({ kind: "built", actions: { withdrawalRequests: 1 } });
  });

  it("starts the chain past a surplus deposit larger than the budget", async () => {
    noMatch();
    // The pool anchor stays the largest; the oversize surplus alone repeats the next chain.
    const oversize = readyDeposit("85", ICKB_DEPOSIT_CAP + 200n, 0n);
    const fitting = readyDeposit("86", 4n, 5n * MINUTE);
    const completeTransaction = vi.fn(completingUpTo(1));
    const runtime = botRuntime({ completeTransaction });

    const result = await buildTransaction(
      runtime,
      botState({
        ckb: ccc.fixedPointFrom(500_000),
        ickb: ICKB_WITHDRAW_ABOVE + 100n,
        poolDeposits: [
          readyDeposit("a0", ICKB_DEPOSIT_CAP + 300n, 0n),
          oversize,
          fitting,
        ],
      }),
    );

    expect(completeTransaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      kind: "built",
      decision: {
        rebalance: { withdrawal: { candidateCount: 2 } },
        core: { kind: "withdraw", withdrawalRequests: 1, attempts: 1 },
      },
    });
  });

  it("collects alone when no withdrawal prefix can complete, and skips when there is nothing", async () => {
    noMatch();
    const only = readyDeposit("87", 4n, 0n);
    const runtime = botRuntime({ completeTransaction: completingUpTo(0) });
    const state = {
      ckb: ccc.fixedPointFrom(500_000),
      ickb: ICKB_WITHDRAW_ABOVE + 100n,
      poolDeposits: pool([only]),
    };

    await expect(
      buildTransaction(
        runtime,
        botState({ ...state, readyWithdrawals: [testWithdrawal("88")] }),
      ),
    ).resolves.toMatchObject({
      kind: "built",
      actions: { withdrawalRequests: 0, withdrawals: 1 },
      decision: { core: { kind: "none", attempts: 2 } },
    });
    await expect(buildTransaction(runtime, botState(state))).resolves.toMatchObject({
      kind: "skipped",
      reason: "no_fundable_candidate",
    });
  });
});
