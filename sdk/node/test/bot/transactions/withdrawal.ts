import { ccc } from "@ckb-ccc/core";
import { IckbError } from "../../../../src/conversion/error.ts";
import { projectAccountAvailability } from "../../../../src/conversion/projection.ts";
import { DAO_HEADER_INDEX_LIMIT } from "../../../../src/dao.ts";
import type { IckbDepositCell } from "../../../../src/logic.ts";
import { ICKB_DEPOSIT_CAP } from "../../../../src/udt.ts";

import { afterEach, describe, expect, it, vi } from "vitest";
import { ICKB_WITHDRAW_ABOVE } from "../../../src/bot/policy.ts";
import { buildTransaction } from "../../../src/bot/transaction.ts";
import type { Runtime } from "../../../src/bot/types.ts";
import {
  botRuntime,
  botState,
  FUNDED_CHANGE,
  l1AccountState,
  readyDeposit,
  testWithdrawal,
} from "../fixtures/bot.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Completion that funds every core carrying at most `maxRequests` withdrawal requests. */
function completingUpTo(maxRequests: number): Runtime["completeTransaction"] {
  const daoScript = botRuntime().managers.ickbLogic.dao.script;
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
  return [readyDeposit("a0", ICKB_DEPOSIT_CAP + 1n), ...extras];
}

describe("buildTransaction withdrawal", () => {
  it("requests the longest fundable prefix of the surplus chain, oldest first", async () => {
    const first = readyDeposit("81", 4n, 30n);
    const second = readyDeposit("82", 6n, 35n);
    const third = readyDeposit("83", 5n, 40n);
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
      decision: {
        actions: { withdrawalRequests: 2 },
        rebalance: { withdrawal: { candidateCount: 3, stress: false } },
        core: { kind: "withdraw", withdrawalRequests: 2, attempts: 2 },
      },
    });
    // The earliest requested claim (thirty minutes out) less the bot's fifteen-minute reserve.
    expect(
      result.kind === "built" &&
        result.broadcastBefore?.eq(ccc.Epoch.from([0n, 15n, 240n])) === true,
    ).toBe(true);
  });

  it("starts the chain past a surplus deposit larger than the budget", async () => {
    // The pool anchor stays the largest; the oversize surplus alone repeats the next chain.
    const oversize = readyDeposit("85", ICKB_DEPOSIT_CAP + 200n, 30n);
    const fitting = readyDeposit("86", 4n, 35n);
    const completeTransaction = vi.fn(completingUpTo(1));
    const runtime = botRuntime({ completeTransaction });

    const result = await buildTransaction(
      runtime,
      botState({
        ckb: ccc.fixedPointFrom(500_000),
        ickb: ICKB_WITHDRAW_ABOVE + 100n,
        poolDeposits: [readyDeposit("a0", ICKB_DEPOSIT_CAP + 300n), oversize, fitting],
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
    const only = readyDeposit("87", 4n);
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
      decision: {
        actions: { withdrawalRequests: 0, withdrawals: 1 },
        core: { kind: "none", attempts: 2 },
      },
    });
    await expect(buildTransaction(runtime, botState(state))).resolves.toMatchObject({
      kind: "skipped",
      reason: "no_fundable_candidate",
    });
  });

  it("collects the projection's ready batch; a request in the same transaction costs it no slot", async () => {
    // One more matured withdrawal than the DAO script addresses; the projection keeps the
    // last one pending for the next turn (no receipts, so every slot is a withdrawal's).
    const withdrawalGroups = Array.from(
      { length: DAO_HEADER_INDEX_LIMIT + 1 },
      (_, index) => testWithdrawal("00", index + 1),
    );
    const { readyWithdrawals, pendingWithdrawals } = projectAccountAvailability(
      { ...l1AccountState().account, withdrawalGroups },
      { available: [], pending: [] },
    );
    expect(readyWithdrawals).toHaveLength(DAO_HEADER_INDEX_LIMIT);
    expect(pendingWithdrawals).toHaveLength(1);
    const runtime = botRuntime({ completeTransaction: completingUpTo(1) });
    const collections = { readyWithdrawals, notReadyWithdrawals: pendingWithdrawals };

    // The fixtures share one request header, pushed after the deposit headers.
    await expect(
      buildTransaction(
        runtime,
        botState({ ckb: ccc.fixedPointFrom(500_000), ...collections }),
      ),
    ).resolves.toMatchObject({
      kind: "built",
      decision: {
        actions: { withdrawalRequests: 0, withdrawals: DAO_HEADER_INDEX_LIMIT },
        transactionShape: { headerDeps: DAO_HEADER_INDEX_LIMIT + 1 },
      },
    });
    // The withdrawals' deposit headers go first, so the request's own deposit header never
    // pushes one past the limit: the full batch and the request ride together (52(an)).
    await expect(
      buildTransaction(
        runtime,
        botState({
          ckb: ccc.fixedPointFrom(500_000),
          ickb: ICKB_WITHDRAW_ABOVE + 100n,
          poolDeposits: pool([readyDeposit("81", 4n)]),
          ...collections,
        }),
      ),
    ).resolves.toMatchObject({
      kind: "built",
      decision: {
        actions: { withdrawalRequests: 1, withdrawals: DAO_HEADER_INDEX_LIMIT },
        core: { kind: "withdraw", attempts: 1 },
        transactionShape: { headerDeps: DAO_HEADER_INDEX_LIMIT + 2 },
      },
    });
    await expect(
      buildTransaction(
        runtime,
        botState({
          ckb: ccc.fixedPointFrom(500_000),
          ickb: ICKB_WITHDRAW_ABOVE + 100n,
          poolDeposits: pool([readyDeposit("81", 4n)]),
          readyWithdrawals: readyWithdrawals.slice(1),
          notReadyWithdrawals: pendingWithdrawals,
        }),
      ),
    ).resolves.toMatchObject({
      kind: "built",
      decision: {
        actions: { withdrawalRequests: 1, withdrawals: DAO_HEADER_INDEX_LIMIT - 1 },
        core: { kind: "withdraw", attempts: 1 },
      },
    });
  });
});
