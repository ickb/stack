import { ccc } from "@ckb-ccc/core";
import { composedClient } from "@ickb/testkit";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  TransactionWaitError,
  waitTransaction,
} from "../../src/send/wait_transaction.ts";
import { hash } from "../transaction/base/support/sdk_core_support.ts";

const TX_HASH = hash("91");
const MAX_TIMEOUT_MS = 2_147_483_647;
const LATE_FAILURE = new Error("late transport failure");

type Gate = PromiseWithResolvers<boolean>;

afterEach(() => {
  vi.useRealTimers();
});

describe("waitTransaction committed status", () => {
  it("raw-polls JSON-RPC status and resolves on commitment without reading the body", async () => {
    const { client, request } = jsonRpcClient({ status: "committed" });
    const noCache = vi.spyOn(client, "getTransactionNoCache");
    const cached = vi.spyOn(client, "getTransaction");

    await expect(waitTransaction(client, TX_HASH)).resolves.toBeUndefined();

    // CCC 1.23 passes optional request options as a second argument; only the payload matters.
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      method: "get_transaction",
      params: [TX_HASH, "0x1"],
    });
    expect(noCache).not.toHaveBeenCalled();
    expect(cached).not.toHaveBeenCalled();
  });
});

describe("waitTransaction terminal rejection", () => {
  it("preserves a raw status-only rejection without reading the body", async () => {
    const reason = "Resolve failed Dead(OutPoint(...))";
    const { client } = jsonRpcClient({ status: "rejected", reason });
    const noCache = vi.spyOn(client, "getTransactionNoCache");

    await expect(waitTransaction(client, TX_HASH)).rejects.toEqual(
      expect.objectContaining({
        name: "TransactionWaitError",
        txHash: TX_HASH,
        status: "rejected",
        reason,
      }),
    );

    expect(noCache).not.toHaveBeenCalled();
  });

  it("sees a status-only rejection through the connector's composed client", async () => {
    // The connector's client is a composition proxy, not a ClientJsonRpc; a rejected
    // transaction has a null body, which the typed read turns into "not yet committed".
    const { client } = jsonRpcClient({ status: "rejected", reason: "dead input" });

    await expect(waitTransaction(composedClient(client), TX_HASH)).rejects.toMatchObject({
      name: "TransactionWaitError",
      status: "rejected",
      reason: "dead input",
    });
  });

  it("preserves a status-only rejection without a string reason", async () => {
    for (const txStatus of [{ status: "rejected" }, { status: "rejected", reason: 1 }]) {
      const { client } = jsonRpcClient(txStatus);

      await expect(waitTransaction(client, TX_HASH)).rejects.toEqual(
        expect.objectContaining({
          message: `Transaction ${TX_HASH} ended with status rejected`,
          status: "rejected",
          reason: undefined,
        }),
      );
    }
  });

  it("treats malformed raw status records as unconfirmed", async () => {
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
      request.mockImplementation(async (payload): Promise<ccc.JsonRpcResponse> => {
        await Promise.resolve();
        return { id: payload.id, jsonrpc: "2.0", result };
      });

      // The window must outlast one poll so the malformed record is parsed.
      await expect(
        waitTransaction(client, TX_HASH, { timeout: 100, interval: 1 }),
      ).rejects.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
    }
  });
});

describe("waitTransaction cache ownership", () => {
  it("never mutates the client cache on commitment or rejection", async () => {
    const { client: committed } = jsonRpcClient({ status: "committed" });
    const { client: rejected } = jsonRpcClient({ status: "rejected" });
    const cacheSpies = [committed, rejected].flatMap((client) => [
      vi.spyOn(client.cache, "clear"),
      vi.spyOn(client.cache, "markTransactions"),
    ]);

    await expect(waitTransaction(committed, TX_HASH)).resolves.toBeUndefined();
    await expect(waitTransaction(rejected, TX_HASH)).rejects.toBeInstanceOf(
      TransactionWaitError,
    );

    for (const spy of cacheSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("waitTransaction option domains", () => {
  it.each([
    { options: { timeout: -1 }, name: "negative timeout" },
    { options: { timeout: 0.5 }, name: "fractional timeout" },
    { options: { timeout: NaN }, name: "NaN timeout" },
    { options: { timeout: Infinity }, name: "infinite timeout" },
    { options: { timeout: MAX_TIMEOUT_MS + 1 }, name: "timer-unsafe timeout" },
    { options: { interval: -1 }, name: "negative interval" },
    { options: { interval: 0.5 }, name: "fractional interval" },
    { options: { interval: NaN }, name: "NaN interval" },
    { options: { interval: Infinity }, name: "infinite interval" },
  ])("rejects $name", async ({ options }) => {
    const { client, request } = jsonRpcClient({ status: "pending" });

    await expect(waitTransaction(client, TX_HASH, options)).rejects.toBeInstanceOf(
      RangeError,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("accepts the largest timeout a host timer can hold", async () => {
    const { client } = jsonRpcClient({ status: "committed" });

    await expect(
      waitTransaction(client, TX_HASH, { timeout: MAX_TIMEOUT_MS }),
    ).resolves.toBeUndefined();
  });

  it("rejects a malformed transaction hash without opening the wait window", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, "addEventListener");
    const { client, request } = jsonRpcClient({ status: "pending" });

    await expect(
      waitTransaction(client, "not-a-hash", { signal: controller.signal }),
    ).rejects.toThrow("Invalid Hex");

    expect(request).not.toHaveBeenCalled();
    expect(addEventListener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitTransaction window closing", () => {
  it("times out before starting work when the budget is already spent", async () => {
    // A frozen clock keeps the first poll at the deadline itself rather than past it.
    vi.useFakeTimers();
    const { client, request } = jsonRpcClient({ status: "pending" });

    await expect(waitTransaction(client, TX_HASH, { timeout: 0 })).rejects.toBeInstanceOf(
      ccc.ErrorClientWaitTransactionTimeout,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("does not poll when the signal is already aborted", async () => {
    const reason = new Error("already stopped");
    const controller = new AbortController();
    controller.abort(reason);
    const { client, request } = jsonRpcClient({ status: "pending" });

    await expect(
      waitTransaction(client, TX_HASH, { signal: controller.signal }),
    ).rejects.toBe(reason);

    expect(request).not.toHaveBeenCalled();
  });

  it("reports a non-Error abort reason through the wait error cause", async () => {
    const gate = Promise.withResolvers<boolean>();
    const controller = new AbortController();
    const { client, request } = jsonRpcClient({ status: "pending" }, gate.promise);

    const waiting = waitTransaction(client, TX_HASH, { signal: controller.signal });
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    controller.abort("polling stopped");

    await expect(waiting).rejects.toEqual(
      expect.objectContaining({
        message: "Transaction wait aborted",
        cause: "polling stopped",
      }),
    );
    gate.resolve(true);
  });

  it("cancels the polling sleep and continues after it elapses", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    const txStatus = { status: "pending" };
    const { client, request } = jsonRpcClient(txStatus);

    const waiting = waitTransaction(client, TX_HASH, {
      interval: 2_000,
      signal: controller.signal,
    });
    // The count is the wait condition: the poll timer must be armed before time advances.
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(2);
    });
    txStatus.status = "committed";
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(waiting).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    // A long-lived signal keeps no listener from a closed window.
    expect(removed).toHaveBeenCalledWith("abort", added.mock.calls[0]?.[1]);
  });

  it("clears the polling sleep when aborted during it", async () => {
    vi.useFakeTimers();
    const reason = new Error("stopped while sleeping");
    const controller = new AbortController();
    const { client, request } = jsonRpcClient({ status: "pending" });

    const waiting = waitTransaction(client, TX_HASH, { signal: controller.signal });
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(2);
    });
    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitTransaction post-operation cancellation", () => {
  it("does not accept a committed status from an operation that aborted", async () => {
    const reason = new Error("stopped during the status read");
    const controller = new AbortController();
    const { client, request } = jsonRpcClient({ status: "committed" });
    request.mockImplementation(async (payload): Promise<ccc.JsonRpcResponse> => {
      controller.abort(reason);
      await Promise.resolve();
      // The status resolves anyway, so nothing but a cancellation recheck stands
      // between this operation and a successful wait.
      return {
        id: payload.id,
        jsonrpc: "2.0",
        result: { transaction: null, tx_status: { status: "committed" } },
      };
    });

    await expect(
      waitTransaction(client, TX_HASH, { signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("does not resolve after an abort that followed the status read", async () => {
    const reason = new Error("stopped after the status read");
    const controller = new AbortController();
    const { client, request } = jsonRpcClient({ status: "committed" });
    // Aborts while the delivered status is inspected: after the last client operation
    // settled and before the wait can resolve.
    const result = {
      transaction: null,
      get tx_status(): { status: string } {
        controller.abort(reason);
        return { status: "committed" };
      },
    };
    request.mockImplementation(async (payload): Promise<ccc.JsonRpcResponse> => {
      await Promise.resolve();
      return { id: payload.id, jsonrpc: "2.0", result };
    });

    await expect(
      waitTransaction(client, TX_HASH, { signal: controller.signal }),
    ).rejects.toBe(reason);
  });
});

describe("waitTransaction in-flight operations", () => {
  it.each([
    {
      name: "late rejection",
      settle: (gate: Gate): void => {
        gate.reject(LATE_FAILURE);
      },
    },
    {
      name: "late fulfillment",
      settle: (gate: Gate): void => {
        gate.resolve(true);
      },
    },
  ])("aborts an in-flight raw request and handles its $name", async ({ settle }) => {
    vi.useFakeTimers();
    const gate = Promise.withResolvers<boolean>();
    const reason = new Error("raw request stopped");
    const controller = new AbortController();
    const { client, request } = jsonRpcClient({ status: "pending" }, gate.promise);
    const waiting = waitTransaction(client, TX_HASH, {
      timeout: 1_000,
      interval: 100,
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });

    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
    settle(gate);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    {
      name: "late rejection",
      settle: (gate: Gate): void => {
        gate.reject(LATE_FAILURE);
      },
    },
    {
      name: "late fulfillment",
      settle: (gate: Gate): void => {
        gate.resolve(true);
      },
    },
  ])("times out an in-flight raw request and handles its $name", async ({ settle }) => {
    vi.useFakeTimers();
    const gate = Promise.withResolvers<boolean>();
    const { client, request } = jsonRpcClient({ status: "pending" }, gate.promise);
    const timedOut = rejectionOf(
      waitTransaction(client, TX_HASH, { timeout: 1_000, interval: 100 }),
    );
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(timedOut).resolves.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
    expect(vi.getTimerCount()).toBe(0);
    settle(gate);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitTransaction absolute budget", () => {
  it("rejects a result that arrives at the deadline before the window timer fires", async () => {
    vi.useFakeTimers();
    const { client, request } = jsonRpcClient({ status: "committed" });
    request.mockImplementation(async (payload): Promise<ccc.JsonRpcResponse> => {
      // The clock reaches the deadline without running the window timer, as when an
      // operation blocks the event loop.
      vi.setSystemTime(Date.now() + 5);
      await Promise.resolve();
      return {
        id: payload.id,
        jsonrpc: "2.0",
        result: { transaction: null, tx_status: { status: "committed" } },
      };
    });

    await expect(
      waitTransaction(client, TX_HASH, { timeout: 5, interval: 0 }),
    ).rejects.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("times out as soon as the next poll could not start inside the window", async () => {
    vi.useFakeTimers();
    const { client, request } = jsonRpcClient({ status: "pending" });
    const start = Date.now();
    let rejectedAt = NaN;
    const timedOut = (async (): Promise<unknown> => {
      const error = await rejectionOf(
        waitTransaction(client, TX_HASH, { timeout: 2_000, interval: 1_000 }),
      );
      rejectedAt = Date.now();
      return error;
    })();

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(timedOut).resolves.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
    // The second poll at 1 s leaves no room for a third, so the wait ends there.
    expect(rejectedAt - start).toBe(1_000);
    expect(request).toHaveBeenCalledTimes(2);
  });
});

async function rejectionOf<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

type JsonRpcRequest = (payload: ccc.JsonRpcPayload) => Promise<ccc.JsonRpcResponse>;

function jsonRpcClient(
  txStatus: unknown,
  gate?: PromiseLike<unknown>,
): {
  client: ccc.ClientPublicTestnet;
  request: Mock<JsonRpcRequest>;
} {
  const request = vi.fn<JsonRpcRequest>(
    async (payload: ccc.JsonRpcPayload): Promise<ccc.JsonRpcResponse> => {
      if (gate !== undefined) {
        await gate;
      }
      await Promise.resolve();
      return {
        id: payload.id,
        jsonrpc: "2.0",
        result: { transaction: null, tx_status: txStatus },
      };
    },
  );
  return {
    client: ccc.ClientPublicTestnet.new({
      transport: { request },
      cache: new ccc.ClientCacheMemory(),
    }),
    request,
  };
}
