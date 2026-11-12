import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BroadcastDeadline } from "../../src/dao.ts";
import { commitTransaction, type CommitStep } from "../../src/send/commit_transaction.ts";
import { hash, headerLike } from "../transaction/base/support/sdk_core_support.ts";

const TX_HASH = hash("81");
const PREPARED_HASH = hash("82");
const TIP_EPOCH = ccc.Epoch.from([10n, 0n, 1n]);
const STEP_MS = 10_000;
const SENT = { ok: true, status: "sent", txHash: TX_HASH };
const PENDING = { ok: true, status: "pending", txHash: TX_HASH };
const COMMITTED = { ok: true, status: "committed", txHash: TX_HASH };
const LOST = new TypeError("fetch failed");
// The fixture tip is dated 0, as is the frozen clock, so a step's 10 s age it.
const BEFORE: BroadcastDeadline = {
  epoch: TIP_EPOCH.add([0n, 1n, 2n]),
  tipMaxAgeMs: 60_000,
};
const REACHED: BroadcastDeadline = { epoch: TIP_EPOCH, tipMaxAgeMs: 60_000 };

afterEach(() => {
  vi.useRealTimers();
});

describe("commitTransaction steps", () => {
  it("broadcasts once, then reads the status until it commits", async () => {
    const { signer, signed, node, request, send, mark } = commitFixture();
    node.status = "pending";
    const steps = commitTransaction(signer, {
      tx: ccc.Transaction.default(),
      plannedFee: 0n,
    });

    await expect(first(steps)).resolves.toEqual(SENT);
    await expect(after(steps)).resolves.toEqual(PENDING);
    node.status = "proposed";
    await expect(after(steps)).resolves.toEqual(PENDING);
    node.status = "committed";
    await expect(after(steps)).resolves.toEqual(COMMITTED);

    await expect(steps.next()).resolves.toEqual({ done: true, value: undefined });
    expect(request).toHaveBeenCalledWith("get_transaction", [TX_HASH, "0x1"]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledExactlyOnceWith(signed);
    expect(mark).not.toHaveBeenCalled();
  });

  it("reads 10 s after the previous step, holding no timer between steps", async () => {
    const { signer, request } = commitFixture();
    const steps = commitTransaction(signer, {
      tx: ccc.Transaction.default(),
      plannedFee: 0n,
    });
    await first(steps);
    expect(vi.getTimerCount()).toBe(0);

    // The caller held the step 4 s, so the read waits the remaining 6 s.
    await vi.advanceTimersByTimeAsync(4_000);
    const pending = steps.next();
    await vi.advanceTimersByTimeAsync(5_999);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ value: { status: "pending" } });
    expect(vi.getTimerCount()).toBe(0);

    // A caller that held the step past the interval is read at once.
    await vi.advanceTimersByTimeAsync(STEP_MS);
    const late = steps.next();
    await vi.advanceTimersByTimeAsync(0);
    await expect(late).resolves.toMatchObject({ value: { status: "pending" } });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("starts nothing before the first step and stops on the caller's break", async () => {
    const { signer, signed, request, send, prepareTransaction } = commitFixture();
    const steps = commitTransaction(signer, {
      tx: ccc.Transaction.default(),
      plannedFee: 0n,
    });
    await vi.advanceTimersByTimeAsync(STEP_MS);
    expect(prepareTransaction).not.toHaveBeenCalled();

    for await (const step of steps) {
      expect(step).toEqual(SENT);
      break;
    }
    await vi.advanceTimersByTimeAsync(10 * STEP_MS);

    expect(send).toHaveBeenCalledExactlyOnceWith(signed);
    expect(request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends rejected with the node's recorded reason, when it gives one", async () => {
    for (const [reason, cause] of [
      [
        "Resolve failed Dead(OutPoint(...))",
        new Error("Resolve failed Dead(OutPoint(...))"),
      ],
      [undefined, undefined],
    ] as const) {
      const { signer, node } = commitFixture();
      node.status = "rejected";
      node.reason = reason;
      const steps = commitTransaction(signer, {
        tx: ccc.Transaction.default(),
        plannedFee: 0n,
      });
      await first(steps);

      await expect(after(steps)).resolves.toEqual({
        ok: false,
        reason: "rejected",
        txHash: TX_HASH,
        cause,
      });
      await expect(steps.next()).resolves.toMatchObject({ done: true });
    }
  });

  it("reports a failed or unreadable status read as pending, and reads again", async () => {
    const { signer, node, request } = commitFixture();
    node.status = "pending";
    const steps = commitTransaction(signer, {
      tx: ccc.Transaction.default(),
      plannedFee: 0n,
    });
    await first(steps);

    request.mockRejectedValueOnce(LOST);
    await expect(after(steps)).resolves.toEqual({ ...PENDING, cause: LOST });
    // Anything thrown that is not an Error is wrapped, its message kept when it has one.
    for (const [thrown, message] of [
      ["boom", "boom"],
      [{ message: "node down" }, "node down"],
      [{ message: 1 }, "[object Object]"],
      [null, "null"],
    ] as const) {
      request.mockRejectedValueOnce(thrown);
      await expect(after(steps)).resolves.toEqual({
        ...PENDING,
        cause: new Error(message, { cause: thrown }),
      });
    }
    node.status = "dropped";
    await expect(after(steps)).resolves.toEqual({
      ...PENDING,
      cause: new Error(`The node gave no known status for transaction ${TX_HASH}`),
    });
    node.status = "committed";
    await expect(after(steps)).resolves.toEqual(COMMITTED);
  });
});

describe("commitTransaction broadcast", () => {
  it("broadcasts an unknown transaction again until a node answer acknowledges it", async () => {
    const { signer, send } = commitFixture();
    const again = new TypeError("socket hang up");
    send.mockRejectedValueOnce(LOST).mockRejectedValueOnce(again);
    const steps = commitTransaction(signer, {
      tx: ccc.Transaction.default(),
      plannedFee: 0n,
    });

    await expect(first(steps)).resolves.toEqual({ ...SENT, cause: LOST });
    await expect(after(steps)).resolves.toEqual({ ...PENDING, cause: again });
    await expect(after(steps)).resolves.toEqual(PENDING);
    // Acknowledged now: an unknown status is waited out, never sent again.
    await expect(after(steps)).resolves.toEqual(PENDING);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("takes a duplicate naming this transaction as acknowledged", async () => {
    const { signer, signed, send } = commitFixture();
    send.mockRejectedValueOnce(duplicatedTransaction(TX_HASH));
    const steps = commitTransaction(signer, {
      tx: ccc.Transaction.default(),
      plannedFee: 0n,
    });

    await expect(first(steps)).resolves.toEqual(SENT);
    await expect(after(steps)).resolves.toEqual(PENDING);
    expect(send).toHaveBeenCalledExactlyOnceWith(signed);
  });

  it.each([-301, -302, -1100, -1111, -1199])(
    "ends rejected when the node refused it with %i and still doesn't know it",
    async (code) => {
      const { signer, signed, send } = commitFixture();
      const refusal = new ccc.ErrorClientBase({ code, message: "refused", data: "" });
      send.mockRejectedValueOnce(refusal);
      const steps = commitTransaction(signer, {
        tx: ccc.Transaction.default(),
        plannedFee: 0n,
      });

      await expect(first(steps)).resolves.toEqual({ ...SENT, cause: refusal });
      await expect(after(steps)).resolves.toEqual({
        ok: false,
        reason: "rejected",
        txHash: TX_HASH,
        cause: refusal,
      });
      expect(send).toHaveBeenCalledExactlyOnceWith(signed);
    },
  );

  it.each([
    {
      name: "a duplicate of another transaction",
      failure: duplicatedTransaction(hash("83")),
    },
    { name: "code -300", failure: { code: -300 } },
    { name: "code -303", failure: { code: -303 } },
    { name: "code -1099", failure: { code: -1099 } },
    { name: "code -1200", failure: { code: -1200 } },
    { name: "an internal error", failure: { code: -1 } },
    { name: "a code that is not a number", failure: { code: "-302" } },
    { name: "a timeout", failure: new DOMException("timed out", "TimeoutError") },
    { name: "a transport error", failure: LOST },
    { name: "a string", failure: "refused" },
    { name: "null", failure: null },
  ])(
    "sends again after $name, which doesn't say the node refused it",
    async ({ failure }) => {
      const { signer, send } = commitFixture();
      send.mockRejectedValueOnce(failure);
      const steps = commitTransaction(signer, {
        tx: ccc.Transaction.default(),
        plannedFee: 0n,
      });

      await expect(first(steps)).resolves.toMatchObject({ status: "sent" });
      await expect(after(steps)).resolves.toEqual(PENDING);
      expect(send).toHaveBeenCalledTimes(2);
    },
  );

  it("forgets a refusal once the node holds the transaction", async () => {
    const { signer, signed, node, send } = commitFixture();
    send.mockRejectedValueOnce(
      new ccc.ErrorClientBase({ code: -1111, message: "", data: "" }),
    );
    node.status = "pending";
    const steps = commitTransaction(signer, {
      tx: ccc.Transaction.default(),
      plannedFee: 0n,
    });
    await first(steps);

    await expect(after(steps)).resolves.toEqual(PENDING);
    node.status = "unknown";
    await expect(after(steps)).resolves.toEqual(PENDING);
    expect(send).toHaveBeenCalledExactlyOnceWith(signed);
  });
});

describe("commitTransaction broadcast deadline", () => {
  it("ends expired, sending nothing, once the tip reached the deadline", async () => {
    const { signer, send } = commitFixture();
    const steps = commitTransaction(signer, {
      tx: ccc.Transaction.default(),
      plannedFee: 0n,
      broadcastBefore: REACHED,
    });

    await expect(first(steps)).resolves.toEqual({
      ok: false,
      reason: "expired",
      txHash: TX_HASH,
    });
    await expect(steps.next()).resolves.toMatchObject({ done: true });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends again before the deadline and abandons it once the tip reaches it", async () => {
    const { signer, node, send } = commitFixture();
    send.mockRejectedValue(LOST);
    const steps = commitTransaction(signer, {
      tx: ccc.Transaction.default(),
      plannedFee: 0n,
      broadcastBefore: BEFORE,
    });
    await first(steps);

    await expect(after(steps)).resolves.toEqual({ ...PENDING, cause: LOST });
    node.tip = headerLike(0n, { epoch: BEFORE.epoch });
    await expect(after(steps)).resolves.toEqual({
      ok: false,
      reason: "abandoned",
      txHash: TX_HASH,
      cause: LOST,
    });
    await expect(steps.next()).resolves.toMatchObject({ done: true });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("reports a stale tip as pending, sending nothing until a fresh one", async () => {
    const { signer, signed, node, send } = commitFixture();
    send.mockRejectedValueOnce(LOST);
    const stale = { ...BEFORE, tipMaxAgeMs: STEP_MS - 1 };
    const steps = commitTransaction(signer, {
      tx: ccc.Transaction.default(),
      plannedFee: 0n,
      broadcastBefore: stale,
    });
    await first(steps);

    const { cause } = await after(steps);
    expect(cause?.message).toMatch("ms old");
    expect(send).toHaveBeenCalledExactlyOnceWith(signed);
    // Dated when the next step reads it.
    node.tip = headerLike(0n, { epoch: TIP_EPOCH, timestamp: Date.now() + STEP_MS });
    await expect(after(steps)).resolves.toEqual(PENDING);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("commitTransaction signing", () => {
  it("ends not signed with the prepared hash, wrapping a refusal that isn't an Error", async () => {
    for (const [refusal, cause] of [
      ["User rejected", new Error("User rejected", { cause: "User rejected" })],
      [LOST, LOST],
    ] as const) {
      const { signer, send, signOnlyTransaction } = commitFixture();
      signOnlyTransaction.mockRejectedValueOnce(refusal);
      const steps = commitTransaction(signer, {
        tx: ccc.Transaction.default(),
        plannedFee: 0n,
      });

      const step = await first(steps);
      expect(step).toEqual({
        ok: false,
        reason: "not-signed",
        txHash: PREPARED_HASH,
        cause,
      });
      expect(step.cause).toBeInstanceOf(Error);
      await expect(steps.next()).resolves.toMatchObject({ done: true });
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("throws before the wallet prompt on a client that isn't JSON-RPC", async () => {
    const { signer, prepareTransaction, signOnlyTransaction } = commitFixture();
    Reflect.deleteProperty(signer.client, "requestor");

    await expect(
      first(commitTransaction(signer, { tx: ccc.Transaction.default(), plannedFee: 0n })),
    ).rejects.toThrow("The SDK needs a JSON-RPC client");
    expect(prepareTransaction).not.toHaveBeenCalled();
    expect(signOnlyTransaction).not.toHaveBeenCalled();
  });
});

type Steps = AsyncGenerator<CommitStep, void, undefined>;

/** The first step, which no wait precedes. */
async function first(steps: Steps): Promise<CommitStep> {
  return stepOf(await steps.next());
}

/** The next step, a full interval after the previous one. */
async function after(steps: Steps): Promise<CommitStep> {
  const next = steps.next();
  await vi.advanceTimersByTimeAsync(STEP_MS);
  return stepOf(await next);
}

function stepOf(result: IteratorResult<CommitStep, void>): CommitStep {
  if (result.done === true) {
    throw new Error("The commit ended");
  }
  return result.value;
}

function duplicatedTransaction(txHash: ccc.Hex): ccc.ErrorClientDuplicatedTransaction {
  return new ccc.ErrorClientDuplicatedTransaction(
    { code: -1107, data: `Duplicated(Byte32(${txHash}))` },
    txHash,
  );
}

interface Node {
  status: string;
  reason: string | undefined;
  tip: ccc.ClientBlockHeader;
}

/**
 * A signer over an empty transaction, signed as `TX_HASH`, on a node whose status and tip
 * a test sets through `node`; the clock is frozen at the tip's date.
 */
function commitFixture(): {
  signer: ccc.Signer;
  signed: ccc.Transaction;
  node: Node;
  request: ReturnType<
    typeof vi.fn<(method: string, params: unknown) => Promise<unknown>>
  >;
  send: ReturnType<typeof vi.fn<(tx: ccc.TransactionLike) => Promise<ccc.Hex>>>;
  mark: ReturnType<typeof vi.fn<() => Promise<void>>>;
  prepareTransaction: ReturnType<typeof vi.fn<() => Promise<ccc.Transaction>>>;
  signOnlyTransaction: ReturnType<typeof vi.fn<() => Promise<ccc.Transaction>>>;
} {
  vi.useFakeTimers({ now: 0 });
  const prepared = ccc.Transaction.default();
  vi.spyOn(prepared, "hash").mockReturnValue(PREPARED_HASH);
  const signed = ccc.Transaction.default();
  vi.spyOn(signed, "hash").mockReturnValue(TX_HASH);
  const node: Node = {
    status: "unknown",
    reason: undefined,
    tip: headerLike(0n, { epoch: TIP_EPOCH, timestamp: 0n }),
  };
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(
    async () => {
      await Promise.resolve();
      return {
        transaction: null,
        tx_status: { status: node.status, reason: node.reason },
      };
    },
  );
  const send = vi.fn<(tx: ccc.TransactionLike) => Promise<ccc.Hex>>(async () => {
    await Promise.resolve();
    return TX_HASH;
  });
  const mark = vi.fn(async () => {
    await Promise.resolve();
  });
  const client = {
    requestor: { request },
    getTipHeader: async (): Promise<ccc.ClientBlockHeader> => {
      await Promise.resolve();
      return node.tip;
    },
    sendTransactionNoCache: send,
    cache: { markTransactions: mark },
  };
  const prepareTransaction = vi.fn(async () => {
    await Promise.resolve();
    return prepared;
  });
  const signOnlyTransaction = vi.fn(async () => {
    await Promise.resolve();
    return signed;
  });
  const signer = { client, prepareTransaction, signOnlyTransaction };
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Focused fixture supplies only the signer and client members a commit calls.
    signer: signer as unknown as ccc.Signer,
    signed,
    node,
    request,
    send,
    mark,
    prepareTransaction,
    signOnlyTransaction,
  };
}
