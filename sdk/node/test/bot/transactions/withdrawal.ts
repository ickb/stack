import { ccc } from "@ckb-ccc/core";
import { IckbError } from "../../../../src/conversion/sdk_error.ts";
import { projectAccountAvailability } from "../../../../src/conversion/sdk_projection.ts";
import {
  DAO_HEADER_INDEX_LIMIT,
  ICKB_DEPOSIT_CAP,
  type IckbDepositCell,
} from "../../../../src/core/index.ts";

import { afterEach, describe, expect, it, vi } from "vitest";
import { ICKB_WITHDRAW_ABOVE } from "../../../src/bot/policy/constants.ts";
import { buildTransaction } from "../../../src/bot/runtime/transaction.ts";
import type { Runtime } from "../../../src/bot/runtime/types.ts";
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

const MINUTE = 60n * 1000n;

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

  it("starts the chain past a surplus deposit larger than the budget", async () => {
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

  it("collects the projection's ready batch; a request that would push a deposit header past the limit is shed", async () => {
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
      actions: { withdrawalRequests: 0, withdrawals: DAO_HEADER_INDEX_LIMIT },
      decision: { transactionShape: { headerDeps: DAO_HEADER_INDEX_LIMIT + 1 } },
    });
    // A withdrawal request's deposit header takes the first slot, so the last withdrawal's
    // header lands on the limit: the withdraw core is unfundable and `none` carries the batch.
    await expect(
      buildTransaction(
        runtime,
        botState({
          ckb: ccc.fixedPointFrom(500_000),
          ickb: ICKB_WITHDRAW_ABOVE + 100n,
          poolDeposits: pool([readyDeposit("81", 4n, 0n)]),
          ...collections,
        }),
      ),
    ).resolves.toMatchObject({
      kind: "built",
      actions: { withdrawalRequests: 0, withdrawals: DAO_HEADER_INDEX_LIMIT },
      decision: { core: { kind: "none", attempts: 2 } },
    });
    // One fewer ready withdrawal leaves the request its slot: the header overflow was the
    // only reason the withdraw core failed.
    await expect(
      buildTransaction(
        runtime,
        botState({
          ckb: ccc.fixedPointFrom(500_000),
          ickb: ICKB_WITHDRAW_ABOVE + 100n,
          poolDeposits: pool([readyDeposit("81", 4n, 0n)]),
          readyWithdrawals: readyWithdrawals.slice(1),
          notReadyWithdrawals: pendingWithdrawals,
        }),
      ),
    ).resolves.toMatchObject({
      kind: "built",
      actions: { withdrawalRequests: 1, withdrawals: DAO_HEADER_INDEX_LIMIT - 1 },
      decision: { core: { kind: "withdraw", attempts: 1 } },
    });
  });
});
