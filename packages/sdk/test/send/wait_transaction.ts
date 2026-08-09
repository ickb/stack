import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { TransactionWaitError, waitTransaction } from "../../src/sdk.ts";
import { hash, headerLike } from "../transaction/base/support/sdk_core_support.ts";

const TX_HASH = hash("91");
const MAX_TIMER_DELAY_MS = 2_147_483_647;

afterEach(() => {
  vi.useRealTimers();
});

describe("waitTransaction", () => {
  it("raw-polls JSON-RPC status before returning the normal CCC response", async () => {
    const response = committedResponse(10n);
    const { client, request } = jsonRpcClient({ status: "committed" });
    const getTransaction = vi.spyOn(client, "getTransaction").mockResolvedValue(response);

    await expect(waitTransaction(client, TX_HASH)).resolves.toBe(response);

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "get_transaction",
        params: [TX_HASH, "0x1"],
      }),
    );
    expect(getTransaction).toHaveBeenCalledWith(TX_HASH);
  });

  it("keeps polling while committed transaction details are unavailable or pending", async () => {
    const pending = new ccc.ClientTransactionResponse(
      ccc.Transaction.default(),
      "pending",
      undefined,
      hash("92"),
      10n,
      undefined,
      "awaiting proposal",
    );
    const response = committedResponse(10n);
    const { client } = jsonRpcClient({ status: "committed" });
    const getTransaction = vi
      .spyOn(client, "getTransaction")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(response);

    await expect(waitTransaction(client, TX_HASH, 0, 1_000, 0)).resolves.toBe(response);

    expect(getTransaction).toHaveBeenCalledTimes(3);
  });

  it("supports CCC confirmation depth semantics", async () => {
    const response = committedResponse(10n);
    const { client } = jsonRpcClient({ status: "committed" });
    vi.spyOn(client, "getTransactionNoCache").mockResolvedValue(response);
    vi.spyOn(client, "getTipHeader")
      .mockResolvedValueOnce(headerLike(11n))
      .mockResolvedValueOnce(headerLike(12n));

    await expect(waitTransaction(client, TX_HASH, 2, 1_000, 0)).resolves.toBe(response);
  });
});

describe("waitTransaction reorg confirmation", () => {
  it("does not confirm a transaction that disappears after commitment", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const response = committedResponse(10n);
    const { client, request, getTransaction, getTipHeader } = confirmationClient(
      { status: "committed" },
      undefined,
    );
    getTransaction.mockResolvedValue(response);
    getTipHeader.mockResolvedValue(headerLike(11n));
    const waiting = rejectionOf(waitTransaction(client, TX_HASH, 2, 1_000, 100));

    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(900);

    await expect(waiting).resolves.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
    expect(request).toHaveBeenCalledTimes(10);
    expect(client.getTipHeader).toHaveBeenCalledTimes(1);
  });

  it("rejects a transaction that is rejected during confirmation", async () => {
    const response = committedResponse(10n);
    const reason = "reorg conflict";
    const { client, getTransaction, getTipHeader } = confirmationClient(
      { status: "committed" },
      { status: "rejected", reason },
    );
    getTransaction.mockResolvedValue(response);
    getTipHeader.mockResolvedValue(headerLike(11n));

    await expect(waitTransaction(client, TX_HASH, 2, 1_000, 0)).rejects.toEqual(
      expect.objectContaining({ status: "rejected", reason }),
    );
    expect(client.getTipHeader).toHaveBeenCalledTimes(1);
  });

  it("returns the refreshed inclusion after disappearance and re-inclusion", async () => {
    const original = committedResponse(10n);
    const reIncluded = committedResponse(20n);
    const { client, getTransaction, getTipHeader } = confirmationClient(
      { status: "committed" },
      undefined,
      { status: "committed" },
    );
    getTransaction.mockResolvedValueOnce(original).mockResolvedValue(reIncluded);
    getTipHeader
      .mockResolvedValueOnce(headerLike(11n))
      .mockResolvedValueOnce(headerLike(21n))
      .mockResolvedValueOnce(headerLike(22n));

    await expect(waitTransaction(client, TX_HASH, 2, 1_000, 0)).resolves.toBe(reIncluded);
    expect(getTransaction).toHaveBeenCalledTimes(3);
  });
});

describe("waitTransaction parameter domains", () => {
  it.each([
    { confirmations: -1, timeout: 1_000, interval: 100, name: "negative confirmations" },
    {
      confirmations: 0.5,
      timeout: 1_000,
      interval: 100,
      name: "fractional confirmations",
    },
    {
      confirmations: NaN,
      timeout: 1_000,
      interval: 100,
      name: "NaN confirmations",
    },
    {
      confirmations: Infinity,
      timeout: 1_000,
      interval: 100,
      name: "infinite confirmations",
    },
    {
      confirmations: Number.MAX_SAFE_INTEGER + 1,
      timeout: 1_000,
      interval: 100,
      name: "unsafe confirmations",
    },
    { confirmations: 0, timeout: -1, interval: 100, name: "negative timeout" },
    { confirmations: 0, timeout: 0.5, interval: 100, name: "fractional timeout" },
    { confirmations: 0, timeout: NaN, interval: 100, name: "NaN timeout" },
    {
      confirmations: 0,
      timeout: -Infinity,
      interval: 100,
      name: "negative infinite timeout",
    },
    {
      confirmations: 0,
      timeout: Number.MAX_SAFE_INTEGER + 1,
      interval: 100,
      name: "unsafe timeout",
    },
    { confirmations: 0, timeout: 1_000, interval: -1, name: "negative interval" },
    { confirmations: 0, timeout: 1_000, interval: 0.5, name: "fractional interval" },
    { confirmations: 0, timeout: 1_000, interval: NaN, name: "NaN interval" },
    {
      confirmations: 0,
      timeout: 1_000,
      interval: Infinity,
      name: "infinite interval",
    },
    {
      confirmations: 0,
      timeout: 1_000,
      interval: Number.MAX_SAFE_INTEGER + 1,
      name: "unsafe interval",
    },
  ])("rejects $name", async ({ confirmations, timeout, interval }) => {
    const { client, request } = jsonRpcClient({ status: "pending" });

    await expect(
      waitTransaction(client, TX_HASH, confirmations, timeout, interval),
    ).rejects.toBeInstanceOf(RangeError);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("waitTransaction long timers", () => {
  it("re-arms a finite timeout that exceeds the host timer limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const gate = Promise.withResolvers<boolean>();
    const { client, request } = jsonRpcClient({ status: "pending" }, gate.promise);
    const waiting = rejectionOf(
      waitTransaction(client, TX_HASH, 0, MAX_TIMER_DELAY_MS + 100, 100),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(MAX_TIMER_DELAY_MS);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(waiting).resolves.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitTransaction cancellation", () => {
  it("does not poll when the signal is already aborted", async () => {
    const reason = new Error("already stopped");
    const controller = new AbortController();
    controller.abort(reason);
    const { client, request } = jsonRpcClient({ status: "pending" });

    await expect(
      waitTransaction(client, TX_HASH, 0, 60_000, 2_000, controller.signal),
    ).rejects.toBe(reason);

    expect(request).not.toHaveBeenCalled();
  });

  it("cancels the current polling sleep without leaving its timer alive", async () => {
    vi.useFakeTimers();
    const reason = new Error("stop waiting");
    const controller = new AbortController();
    const { client, request } = jsonRpcClient({ status: "pending" });
    const waiting = waitTransaction(client, TX_HASH, 0, 60_000, 2_000, controller.signal);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(2);
    });

    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("continues polling after an abortable sleep elapses", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const txStatus = { status: "pending" };
    const { client, request } = jsonRpcClient(txStatus);
    const response = committedResponse(10n);
    vi.spyOn(client, "getTransaction").mockResolvedValue(response);

    const waiting = waitTransaction(client, TX_HASH, 0, 60_000, 2_000, controller.signal);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(2);
    });
    txStatus.status = "committed";
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(waiting).resolves.toBe(response);
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("catches an abort that races with listener registration", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { client } = jsonRpcClient({ status: "pending" });
    const addEventListener = controller.signal.addEventListener.bind(controller.signal);
    vi.spyOn(controller.signal, "addEventListener").mockImplementation((...args) => {
      controller.abort("registration stopped");
      addEventListener(...args);
    });

    await expect(
      waitTransaction(client, TX_HASH, 0, 60_000, 2_000, controller.signal),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "Transaction wait aborted",
        cause: "registration stopped",
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitTransaction in-flight raw cancellation", () => {
  it("aborts an unresolved raw request with its exact reason and handles a late rejection", async () => {
    vi.useFakeTimers();
    const gate = Promise.withResolvers<boolean>();
    const reason = new Error("raw request stopped");
    const lateError = new Error("late transport failure");
    const controller = new AbortController();
    const { client, request } = jsonRpcClient({ status: "pending" }, gate.promise);
    const waiting = waitTransaction(client, TX_HASH, 0, 1_000, 100, controller.signal);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);
    });

    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
    gate.reject(lateError);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles a late raw fulfillment after abort", async () => {
    vi.useFakeTimers();
    const gate = Promise.withResolvers<boolean>();
    const reason = new Error("raw request stopped");
    const controller = new AbortController();
    const { client, request } = jsonRpcClient({ status: "pending" }, gate.promise);
    const waiting = waitTransaction(client, TX_HASH, 0, 1_000, 100, controller.signal);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });

    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    gate.resolve(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitTransaction in-flight raw timeout", () => {
  it("times out an unresolved raw request and cleans its timer", async () => {
    vi.useFakeTimers();
    const gate = Promise.withResolvers<boolean>();
    const { client, request } = jsonRpcClient({ status: "pending" }, gate.promise);
    const waiting = waitTransaction(client, TX_HASH, 0, 1_000, 100);
    const timedOut = rejectionOf(waiting);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(timedOut).resolves.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
    expect(vi.getTimerCount()).toBe(0);
    gate.reject(new Error("late transport failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles a late raw fulfillment after timeout", async () => {
    vi.useFakeTimers();
    const gate = Promise.withResolvers<boolean>();
    const { client, request } = jsonRpcClient({ status: "pending" }, gate.promise);
    const waiting = rejectionOf(waitTransaction(client, TX_HASH, 0, 1_000, 100));
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(waiting).resolves.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
    gate.resolve(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out before starting work when the deadline has elapsed", async () => {
    const { client, request } = jsonRpcClient({ status: "pending" });

    await expect(waitTransaction(client, TX_HASH, 0, 0, 100)).rejects.toBeInstanceOf(
      ccc.ErrorClientWaitTransactionTimeout,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps Infinity compatible for an unresolved operation", async () => {
    vi.useFakeTimers();
    const gate = Promise.withResolvers<boolean>();
    const reason = new Error("infinite wait stopped");
    const controller = new AbortController();
    const { client, request } = jsonRpcClient({ status: "pending" }, gate.promise);

    // eslint-disable-next-line no-restricted-syntax -- This compatibility test proves the public waiter still accepts Infinity.
    const waiting = waitTransaction(client, TX_HASH, 0, Infinity, 100, controller.signal);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });
    await vi.advanceTimersByTimeAsync(60_000);
    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitTransaction raw status failures", () => {
  it("preserves abort while clearing a known terminal rejection", async () => {
    const pending = Promise.withResolvers<never>();
    const reason = new Error("stop rejected wait");
    const controller = new AbortController();
    const { client } = jsonRpcClient({ status: "rejected" });
    const clear = vi
      .spyOn(client.cache, "clear")
      .mockImplementation(async () => pending.promise);
    const waiting = waitTransaction(client, TX_HASH, 0, 60_000, 100, controller.signal);
    await vi.waitFor(() => {
      expect(clear).toHaveBeenCalledTimes(1);
    });

    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
  });

  it("preserves a status-only rejection when cache clearing fails", async () => {
    const reason = "Resolve failed Dead(OutPoint(...))";
    const { client } = jsonRpcClient({ status: "rejected", reason });
    const clear = vi.spyOn(client.cache, "clear").mockRejectedValue(new Error("cache"));
    const getTransaction = vi.spyOn(client, "getTransaction");

    await expect(waitTransaction(client, TX_HASH)).rejects.toEqual(
      expect.objectContaining({
        name: "TransactionWaitError",
        txHash: TX_HASH,
        status: "rejected",
        reason,
        rebuildReady: false,
      }),
    );

    expect(clear).toHaveBeenCalledTimes(1);
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("preserves a status-only rejection without a reason", async () => {
    const { client } = jsonRpcClient({ status: "rejected" });

    await expect(waitTransaction(client, TX_HASH)).rejects.toEqual(
      expect.objectContaining({
        message: `Transaction ${TX_HASH} ended with status rejected`,
        status: "rejected",
        reason: undefined,
        rebuildReady: true,
      }),
    );
  });

  it("preserves terminal rejection when best-effort cache clear times out", async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<never>();
    const { client } = jsonRpcClient({ status: "rejected" });
    const clear = vi
      .spyOn(client.cache, "clear")
      .mockImplementation(async () => pending.promise);
    const waiting = waitTransaction(client, TX_HASH, 0, 1_000, 100);
    const timedOut = rejectionOf(waiting);
    await vi.waitFor(() => {
      expect(clear).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(timedOut).resolves.toEqual(
      expect.objectContaining({
        name: "TransactionWaitError",
        status: "rejected",
        txHash: TX_HASH,
        rebuildReady: false,
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a successful rejection clear as rebuild-ready", async () => {
    const { client } = jsonRpcClient({ status: "rejected" });
    const clear = vi.spyOn(client.cache, "clear").mockResolvedValue(undefined);

    await expect(waitTransaction(client, TX_HASH)).rejects.toMatchObject({
      status: "rejected",
      rebuildReady: true,
    });
    expect(clear).toHaveBeenCalledTimes(1);
  });
});

describe("waitTransaction non-terminal cache ownership", () => {
  it("does not clear cache on timeout, abort, or unknown polling failure", async () => {
    const timeoutClient = jsonRpcClient({ status: "pending" }).client;
    const timeoutClear = vi.spyOn(timeoutClient.cache, "clear");
    await expect(waitTransaction(timeoutClient, TX_HASH, 0, 0)).rejects.toBeInstanceOf(
      ccc.ErrorClientWaitTransactionTimeout,
    );
    expect(timeoutClear).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort(new Error("stopped"));
    const abortClient = jsonRpcClient({ status: "pending" }).client;
    const abortClear = vi.spyOn(abortClient.cache, "clear");
    await expect(
      waitTransaction(abortClient, TX_HASH, 0, 1_000, 100, controller.signal),
    ).rejects.toThrow("stopped");
    expect(abortClear).not.toHaveBeenCalled();

    const unknownClient = jsonRpcClient({ status: "pending" }).client;
    const unknownClear = vi.spyOn(unknownClient.cache, "clear");
    vi.spyOn(unknownClient.requestor, "request").mockRejectedValueOnce(
      new Error("unknown RPC failure"),
    );
    await expect(waitTransaction(unknownClient, TX_HASH)).rejects.toThrow(
      "unknown RPC failure",
    );
    expect(unknownClear).not.toHaveBeenCalled();
  });
});

describe("waitTransaction malformed raw status", () => {
  it("treats malformed raw status records as unconfirmed", async () => {
    vi.useFakeTimers();
    for (const result of [
      "malformed",
      null,
      {},
      { tx_status: "pending" },
      { tx_status: null },
      { tx_status: {} },
      { tx_status: { status: 1, reason: 1 } },
    ]) {
      const { client, request } = jsonRpcClient({});
      request.mockImplementation(async (payload) => {
        await Promise.resolve();
        return { id: payload.id, result, error: null };
      });
      const waiting = rejectionOf(waitTransaction(client, TX_HASH, 0, 1_000, 1_000));
      await vi.waitFor(() => {
        expect(request).toHaveBeenCalledTimes(1);
      });

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(waiting).resolves.toBeInstanceOf(
        ccc.ErrorClientWaitTransactionTimeout,
      );
    }
  });
});

describe("waitTransaction non-JSON fallback", () => {
  it("uses the best available CCC fallback for non-JSON clients", async () => {
    const reason = "fallback rejection";
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- The fallback intentionally supports non-JSON Client implementations through this public surface.
    const client = {
      cache: new ccc.ClientCacheMemory(),
      getTransaction: vi
        .fn()
        .mockResolvedValue(
          new ccc.ClientTransactionResponse(
            ccc.Transaction.default(),
            "rejected",
            undefined,
            undefined,
            undefined,
            undefined,
            reason,
          ),
        ),
    } as unknown as ccc.Client;

    await expect(waitTransaction(client, TX_HASH)).rejects.toBeInstanceOf(
      TransactionWaitError,
    );
  });

  it("keeps polling a non-JSON client until transaction details appear", async () => {
    const response = committedResponse(10n);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- The fallback intentionally supports non-JSON Client implementations through this public surface.
    const client = {
      cache: new ccc.ClientCacheMemory(),
      getTransaction: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue(response),
    } as unknown as ccc.Client;

    await expect(waitTransaction(client, TX_HASH, 0, 1_000, 0)).resolves.toBe(response);
  });
});

describe("waitTransaction in-flight fallback and confirmation", () => {
  it("aborts an unresolved non-JSON getTransaction with its exact reason", async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<ccc.ClientTransactionResponse | undefined>();
    const reason = new Error("fallback stopped");
    const controller = new AbortController();
    const { client, getTransaction } = nonJsonClient(async () => pending.promise);
    const waiting = waitTransaction(client, TX_HASH, 0, 1_000, 100, controller.signal);
    await vi.waitFor(() => {
      expect(getTransaction).toHaveBeenCalledTimes(1);
    });

    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out an unresolved non-JSON getTransaction", async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<ccc.ClientTransactionResponse | undefined>();
    const { client, getTransaction } = nonJsonClient(async () => pending.promise);
    const waiting = waitTransaction(client, TX_HASH, 0, 1_000, 100);
    const timedOut = rejectionOf(waiting);
    await vi.waitFor(() => {
      expect(getTransaction).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(timedOut).resolves.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses one absolute timeout budget across raw status and transaction lookup", async () => {
    vi.useFakeTimers();
    const rawGate = Promise.withResolvers<boolean>();
    const details = Promise.withResolvers<ccc.ClientTransactionResponse | undefined>();
    const { client, request } = jsonRpcClient({ status: "committed" }, rawGate.promise);
    const getTransaction = vi
      .spyOn(client, "getTransaction")
      .mockImplementation(async () => details.promise);
    const startedAt = Date.now();
    const waiting = waitTransaction(client, TX_HASH, 0, 1_000, 100);
    const timedOut = rejectionOf(waiting);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    await vi.advanceTimersByTimeAsync(600);
    rawGate.resolve(true);
    await vi.waitFor(() => {
      expect(getTransaction).toHaveBeenCalledTimes(1);
    });

    const remaining = 1_000 - (Date.now() - startedAt);
    expect(remaining).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(remaining - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(timedOut).resolves.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitTransaction in-flight confirmation", () => {
  it("aborts an unresolved getTipHeader with its exact reason", async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<ccc.ClientBlockHeader>();
    const reason = new Error("confirmation stopped");
    const controller = new AbortController();
    const response = committedResponse(10n);
    const { client } = jsonRpcClient({ status: "committed" });
    vi.spyOn(client, "getTransactionNoCache").mockResolvedValue(response);
    const getTipHeader = vi
      .spyOn(client, "getTipHeader")
      .mockImplementation(async () => pending.promise);
    const waiting = waitTransaction(client, TX_HASH, 1, 1_000, 100, controller.signal);
    await vi.waitFor(() => {
      expect(getTipHeader).toHaveBeenCalledTimes(1);
    });

    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out an unresolved getTipHeader", async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<ccc.ClientBlockHeader>();
    const response = committedResponse(10n);
    const { client } = jsonRpcClient({ status: "committed" });
    vi.spyOn(client, "getTransactionNoCache").mockResolvedValue(response);
    const getTipHeader = vi
      .spyOn(client, "getTipHeader")
      .mockImplementation(async () => pending.promise);
    const waiting = waitTransaction(client, TX_HASH, 1, 1_000, 100);
    const timedOut = rejectionOf(waiting);
    await vi.waitFor(() => {
      expect(getTipHeader).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(timedOut).resolves.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses CCC's timeout error and boundary behavior", async () => {
    const { client } = jsonRpcClient({ status: "pending" });

    await expect(waitTransaction(client, TX_HASH, 0, 1, 1)).rejects.toBeInstanceOf(
      ccc.ErrorClientWaitTransactionTimeout,
    );
  });
});

function committedResponse(blockNumber: bigint): ccc.ClientTransactionResponse {
  return new ccc.ClientTransactionResponse(
    ccc.Transaction.default(),
    "committed",
    undefined,
    hash("92"),
    blockNumber,
  );
}

async function rejectionOf<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

function nonJsonClient(
  getTransaction: () => Promise<ccc.ClientTransactionResponse | undefined>,
): {
  client: ccc.Client;
  getTransaction: Mock<() => Promise<ccc.ClientTransactionResponse | undefined>>;
} {
  const getTransactionMock = vi.fn(getTransaction);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Tests exercise the documented fallback through the public Client surface.
  const client = {
    cache: new ccc.ClientCacheMemory(),
    getTransaction: getTransactionMock,
  } as unknown as ccc.Client;
  return { client, getTransaction: getTransactionMock };
}

type JsonRpcRequest = (
  payload: Parameters<ccc.RequestorJsonRpc["requestPayload"]>[0],
) => Promise<{ id: number; result: unknown; error: null }>;

function confirmationClient(...txStatuses: unknown[]): {
  client: ccc.ClientPublicTestnet;
  request: Mock<JsonRpcRequest>;
  getTransaction: Mock<ccc.ClientPublicTestnet["getTransactionNoCache"]>;
  getTipHeader: Mock<ccc.ClientPublicTestnet["getTipHeader"]>;
} {
  const { client, request } = jsonRpcClient(txStatuses[0]);
  request.mockImplementation(rpcStatuses(...txStatuses));
  return {
    client,
    request,
    getTransaction: vi.spyOn(client, "getTransactionNoCache"),
    getTipHeader: vi.spyOn(client, "getTipHeader"),
  };
}

function rpcStatuses(...txStatuses: unknown[]): JsonRpcRequest {
  let index = 0;
  return async (payload) => {
    const txStatus = txStatuses[Math.min(index, txStatuses.length - 1)];
    index += 1;
    await Promise.resolve();
    return {
      id: payload.id,
      result: { transaction: null, tx_status: txStatus },
      error: null,
    };
  };
}

function jsonRpcClient(
  txStatus: unknown,
  gate?: PromiseLike<unknown>,
): {
  client: ccc.ClientPublicTestnet;
  request: Mock<JsonRpcRequest>;
} {
  const request = vi.fn<JsonRpcRequest>(
    async (
      payload: Parameters<ccc.RequestorJsonRpc["requestPayload"]>[0],
    ): Promise<{ id: number; result: unknown; error: null }> => {
      if (gate !== undefined) {
        await gate;
      }
      await Promise.resolve();
      return {
        id: payload.id,
        result: { transaction: null, tx_status: txStatus },
        error: null,
      };
    },
  );
  const requestor = new ccc.RequestorJsonRpc("https://example.invalid", {
    transport: { request },
  });
  return {
    client: new ccc.ClientPublicTestnet({
      url: "https://example.invalid",
      requestor,
      cache: new ccc.ClientCacheMemory(),
    }),
    request,
  };
}
