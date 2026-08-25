import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { TransactionWaitError, waitTransaction } from "../../src/sdk.ts";
import { hash, headerLike } from "../transaction/base/support/sdk_core_support.ts";

const TX_HASH = hash("91");
const MAX_TIMEOUT_MS = 2_147_483_647;
const LATE_FAILURE = new Error("late transport failure");

type Gate = PromiseWithResolvers<boolean>;

afterEach(() => {
  vi.useRealTimers();
});

describe("waitTransaction committed reads", () => {
  it("raw-polls JSON-RPC status and reads the body without the cache", async () => {
    const response = committedResponse(10n);
    const { client, request } = jsonRpcClient({ status: "committed" });
    const noCache = vi.spyOn(client, "getTransactionNoCache").mockResolvedValue(response);
    const cached = vi.spyOn(client, "getTransaction");

    await expect(waitTransaction(client, TX_HASH)).resolves.toBe(response);

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "get_transaction",
        params: [TX_HASH, "0x1"],
      }),
    );
    expect(noCache).toHaveBeenCalledWith(TX_HASH);
    expect(cached).not.toHaveBeenCalled();
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
    const noCache = vi
      .spyOn(client, "getTransactionNoCache")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(response);

    await expect(
      waitTransaction(client, TX_HASH, { timeout: 1_000, interval: 0 }),
    ).resolves.toBe(response);

    expect(noCache).toHaveBeenCalledTimes(3);
  });

  it("keeps polling while the body reports an unknown transaction with block metadata", async () => {
    const unknown = new ccc.ClientTransactionResponse(
      ccc.Transaction.default(),
      "unknown",
      undefined,
      hash("92"),
      10n,
    );
    const response = committedResponse(10n);
    const { client } = jsonRpcClient({ status: "committed" });
    const noCache = vi
      .spyOn(client, "getTransactionNoCache")
      .mockResolvedValueOnce(unknown)
      .mockResolvedValueOnce(response);

    await expect(
      waitTransaction(client, TX_HASH, { timeout: 1_000, interval: 0 }),
    ).resolves.toBe(response);

    expect(noCache).toHaveBeenCalledTimes(2);
  });

  it("reads status and body without the cache for non-JSON clients", async () => {
    const response = committedResponse(10n);
    const { client, getTransactionNoCache } = nonJsonClient();
    getTransactionNoCache.mockResolvedValueOnce(undefined).mockResolvedValue(response);

    await expect(
      waitTransaction(client, TX_HASH, { timeout: 1_000, interval: 0 }),
    ).resolves.toBe(response);

    expect(getTransactionNoCache).toHaveBeenCalledTimes(2);
  });
});

describe("waitTransaction generic client bodies", () => {
  it("accepts a structurally valid committed body from a generic client", async () => {
    const { client, getTransactionNoCache } = nonJsonClient();
    getTransactionNoCache.mockResolvedValue({
      transaction: ccc.Transaction.default(),
      status: "committed",
      blockHash: hash("92"),
      blockNumber: 10n,
    });

    await expect(
      waitTransaction(client, TX_HASH, { timeout: 1_000, interval: 0 }),
    ).resolves.toMatchObject({ status: "committed", blockNumber: 10n });
  });

  it.each([
    { name: "a missing transaction", body: { status: "committed", blockNumber: 10n } },
    {
      name: "invalid transaction data",
      body: {
        transaction: { version: "not-a-number" },
        status: "committed",
        blockNumber: 10n,
      },
    },
    {
      name: "an invalid block number",
      body: {
        transaction: ccc.Transaction.default(),
        status: "committed",
        blockNumber: "not-a-number",
      },
    },
    {
      name: "an invalid block hash",
      body: {
        transaction: ccc.Transaction.default(),
        status: "committed",
        blockNumber: 10n,
        blockHash: "not-a-hash",
      },
    },
  ])("treats a generic committed body with $name as unconfirmed", async ({ body }) => {
    const { client, getTransactionNoCache } = nonJsonClient();
    getTransactionNoCache.mockResolvedValue(body);

    // The window must outlast one poll so the malformed body is normalized, and
    // ending at the timeout is the proof that nothing committed was returned.
    await expect(
      waitTransaction(client, TX_HASH, { timeout: 100, interval: 1 }),
    ).rejects.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
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

  it("preserves a status-only rejection without a reason", async () => {
    const { client } = jsonRpcClient({ status: "rejected" });

    await expect(waitTransaction(client, TX_HASH)).rejects.toEqual(
      expect.objectContaining({
        message: `Transaction ${TX_HASH} ended with status rejected`,
        status: "rejected",
        reason: undefined,
      }),
    );
  });

  it("reports a rejection surfaced only by a non-JSON client response", async () => {
    const { client, getTransactionNoCache } = nonJsonClient();
    getTransactionNoCache.mockResolvedValue(
      new ccc.ClientTransactionResponse(
        ccc.Transaction.default(),
        "rejected",
        undefined,
        undefined,
        undefined,
        undefined,
        "fallback rejection",
      ),
    );

    await expect(waitTransaction(client, TX_HASH)).rejects.toBeInstanceOf(
      TransactionWaitError,
    );
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
      request.mockImplementation(async (payload) => {
        await Promise.resolve();
        return { id: payload.id, result, error: null };
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
    vi.spyOn(committed, "getTransactionNoCache").mockResolvedValue(
      committedResponse(10n),
    );
    const { client: rejected } = jsonRpcClient({ status: "rejected" });
    const cacheSpies = [committed, rejected].flatMap((client) => [
      vi.spyOn(client.cache, "clear"),
      vi.spyOn(client.cache, "markTransactions"),
    ]);

    await expect(waitTransaction(committed, TX_HASH)).resolves.toMatchObject({
      status: "committed",
    });
    await expect(waitTransaction(rejected, TX_HASH)).rejects.toBeInstanceOf(
      TransactionWaitError,
    );

    for (const spy of cacheSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("waitTransaction confirmation depth", () => {
  it("rechecks inclusion without cache once the tip is deep enough", async () => {
    const response = committedResponse(10n);
    const { client, getTransactionNoCache, getTipHeader } = confirmationClient({
      status: "committed",
    });
    getTransactionNoCache.mockResolvedValue(response);
    getTipHeader
      .mockResolvedValueOnce(headerLike(11n))
      .mockResolvedValue(headerLike(12n));

    await expect(
      waitTransaction(client, TX_HASH, { confirmations: 2, timeout: 1_000, interval: 0 }),
    ).resolves.toBe(response);

    expect(getTipHeader).toHaveBeenCalledTimes(2);
    // One body read per poll plus the recheck that confirmed the same inclusion.
    expect(getTransactionNoCache).toHaveBeenCalledTimes(3);
  });

  it("does not confirm a transaction the recheck finds in another block", async () => {
    const { client, getTransactionNoCache, getTipHeader } = confirmationClient({
      status: "committed",
    });
    getTransactionNoCache
      .mockResolvedValueOnce(committedResponse(10n, "92"))
      .mockResolvedValueOnce(committedResponse(20n, "93"))
      .mockResolvedValue(undefined);
    getTipHeader.mockResolvedValue(headerLike(12n));

    await expect(
      waitTransaction(client, TX_HASH, { confirmations: 2, timeout: 100, interval: 10 }),
    ).rejects.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
  });

  it("does not confirm a transaction the recheck no longer finds committed", async () => {
    const { client, getTransactionNoCache, getTipHeader } = confirmationClient(
      { status: "committed" },
      { status: "pending" },
    );
    getTransactionNoCache.mockResolvedValue(committedResponse(10n));
    getTipHeader.mockResolvedValue(headerLike(12n));

    await expect(
      waitTransaction(client, TX_HASH, { confirmations: 2, timeout: 100, interval: 10 }),
    ).rejects.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
    expect(getTransactionNoCache).toHaveBeenCalledTimes(1);
  });

  it("reports a rejection discovered by the depth recheck", async () => {
    const reason = "reorg conflict";
    const { client, request, getTransactionNoCache, getTipHeader } = confirmationClient(
      { status: "committed" },
      { status: "rejected", reason },
    );
    getTransactionNoCache.mockResolvedValue(committedResponse(10n));
    getTipHeader.mockResolvedValue(headerLike(12n));

    await expect(
      waitTransaction(client, TX_HASH, { confirmations: 2, timeout: 1_000, interval: 0 }),
    ).rejects.toEqual(expect.objectContaining({ status: "rejected", reason }));

    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("waitTransaction call forms", () => {
  it("enforces a positional confirmation depth instead of defaulting to zero", async () => {
    const { client, getTransactionNoCache, getTipHeader } = confirmationClient({
      status: "committed",
    });
    getTransactionNoCache.mockResolvedValue(committedResponse(10n));
    getTipHeader.mockResolvedValue(headerLike(10n));

    // A tip at the committed block is depth zero, so only a wait that read the
    // positional depth keeps polling until its positional timeout.
    await expect(waitTransaction(client, TX_HASH, 2, 100, 10)).rejects.toBeInstanceOf(
      ccc.ErrorClientWaitTransactionTimeout,
    );
    expect(getTipHeader).toHaveBeenCalledWith();
  });

  it("shares the option domains with the positional form", async () => {
    const { client, request } = jsonRpcClient({ status: "pending" });

    await expect(waitTransaction(client, TX_HASH, 0, Infinity)).rejects.toBeInstanceOf(
      RangeError,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects mixing the two call forms", async () => {
    const { client } = jsonRpcClient({ status: "pending" });

    await expect(
      // @ts-expect-error The options form takes no trailing positional arguments.
      waitTransaction(client, TX_HASH, { timeout: 1 }, 100),
    ).rejects.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
  });

  it("aborts through a positional signal", async () => {
    const reason = new Error("positional stop");
    const controller = new AbortController();
    controller.abort(reason);
    const { client } = jsonRpcClient({ status: "pending" });

    await expect(
      waitTransaction(client, TX_HASH, 0, 1_000, 10, controller.signal),
    ).rejects.toBe(reason);
  });
});

describe("waitTransaction option domains", () => {
  it.each([
    { options: { confirmations: -1 }, name: "negative confirmations" },
    { options: { confirmations: 0.5 }, name: "fractional confirmations" },
    { options: { confirmations: NaN }, name: "NaN confirmations" },
    { options: { confirmations: Infinity }, name: "infinite confirmations" },
    {
      options: { confirmations: Number.MAX_SAFE_INTEGER + 1 },
      name: "unsafe confirmations",
    },
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

  it("rejects a malformed transaction hash without opening the wait window", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, "addEventListener");
    const { client, request } = jsonRpcClient({ status: "pending" });

    await expect(
      waitTransaction(client, "not-a-hash", { signal: controller.signal }),
    ).rejects.toThrow("Invalid bytes");

    expect(request).not.toHaveBeenCalled();
    expect(addEventListener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitTransaction window closing", () => {
  it("times out before starting work when the budget is already spent", async () => {
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
    const txStatus = { status: "pending" };
    const { client, request } = jsonRpcClient(txStatus);
    vi.spyOn(client, "getTransactionNoCache").mockResolvedValue(committedResponse(10n));

    const waiting = waitTransaction(client, TX_HASH, {
      interval: 2_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(2);
    });
    txStatus.status = "committed";
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(waiting).resolves.toMatchObject({ status: "committed" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitTransaction post-operation cancellation", () => {
  it("does not accept a committed body from an operation that aborted", async () => {
    const reason = new Error("stopped during the body read");
    const controller = new AbortController();
    const { client, getTransactionNoCache } = nonJsonClient();
    getTransactionNoCache.mockImplementation(async () => {
      controller.abort(reason);
      await Promise.resolve();
      // The body resolves anyway, so nothing but a cancellation recheck stands
      // between this operation and a successful wait.
      return committedResponse(10n);
    });

    await expect(
      waitTransaction(client, TX_HASH, { signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("does not return committed state after an abort that followed the body read", async () => {
    const reason = new Error("stopped after the body read");
    const controller = new AbortController();
    const response = committedResponse(10n);
    // Aborts while the delivered body is inspected: after the last client
    // operation settled and before the wait can return it.
    Object.defineProperty(response, "blockNumber", {
      get: (): bigint => {
        controller.abort(reason);
        return 10n;
      },
    });
    const { client, getTransactionNoCache } = nonJsonClient();
    getTransactionNoCache.mockResolvedValue(response);

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
  it("spends one absolute budget across raw status, body, and tip reads", async () => {
    vi.useFakeTimers();
    const rawGate = Promise.withResolvers<boolean>();
    const body = Promise.withResolvers<ccc.ClientTransactionResponse | undefined>();
    const { client, request } = jsonRpcClient({ status: "committed" }, rawGate.promise);
    const noCache = vi
      .spyOn(client, "getTransactionNoCache")
      .mockImplementation(async () => body.promise);
    const startedAt = Date.now();
    const timedOut = rejectionOf(
      waitTransaction(client, TX_HASH, { timeout: 1_000, interval: 100 }),
    );
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    await vi.advanceTimersByTimeAsync(600);
    rawGate.resolve(true);
    await vi.waitFor(() => {
      expect(noCache).toHaveBeenCalledTimes(1);
    });

    const remaining = 1_000 - (Date.now() - startedAt);
    expect(remaining).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(remaining - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(timedOut).resolves.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an overdue result from an operation that starved the timer", async () => {
    const { client, getTransactionNoCache } = nonJsonClient();
    getTransactionNoCache.mockImplementation(async () => {
      // Block the event loop past the deadline so the window timer cannot fire.
      const blockUntil = Date.now() + 30;
      while (Date.now() < blockUntil) {
        // Deliberately empty: a synchronous client operation holds the loop.
      }
      // A microtask still cannot let the starved timer run before this returns.
      await Promise.resolve();
      return committedResponse(10n);
    });

    await expect(
      waitTransaction(client, TX_HASH, { timeout: 5, interval: 0 }),
    ).rejects.toBeInstanceOf(ccc.ErrorClientWaitTransactionTimeout);

    expect(getTransactionNoCache).toHaveBeenCalledTimes(1);
  });

  it("aborts an unresolved tip read with its exact reason", async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<ccc.ClientBlockHeader>();
    const reason = new Error("confirmation stopped");
    const controller = new AbortController();
    const { client } = jsonRpcClient({ status: "committed" });
    vi.spyOn(client, "getTransactionNoCache").mockResolvedValue(committedResponse(10n));
    const getTipHeader = vi
      .spyOn(client, "getTipHeader")
      .mockImplementation(async () => pending.promise);
    const waiting = waitTransaction(client, TX_HASH, {
      confirmations: 1,
      timeout: 1_000,
      interval: 100,
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(getTipHeader).toHaveBeenCalledTimes(1);
    });

    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });
});

function committedResponse(
  blockNumber: bigint,
  blockHashByte = "92",
): ccc.ClientTransactionResponse {
  return new ccc.ClientTransactionResponse(
    ccc.Transaction.default(),
    "committed",
    undefined,
    hash(blockHashByte),
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

function nonJsonClient(): {
  client: ccc.Client;
  // A generic client is not bound to CCC's response class, so the fake returns
  // whatever such an implementation could.
  getTransactionNoCache: Mock<() => Promise<unknown>>;
} {
  const getTransactionNoCache = vi.fn<() => Promise<unknown>>();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- The fallback intentionally supports non-JSON Client implementations through this public surface.
  const client = {
    cache: new ccc.ClientCacheMemory(),
    getTransactionNoCache,
  } as unknown as ccc.Client;
  return { client, getTransactionNoCache };
}

type JsonRpcRequest = (
  payload: Parameters<ccc.RequestorJsonRpc["requestPayload"]>[0],
) => Promise<{ id: number; result: unknown; error: null }>;

function confirmationClient(...txStatuses: unknown[]): {
  client: ccc.ClientPublicTestnet;
  request: Mock<JsonRpcRequest>;
  getTransactionNoCache: Mock<ccc.ClientPublicTestnet["getTransactionNoCache"]>;
  getTipHeader: Mock<ccc.ClientPublicTestnet["getTipHeader"]>;
} {
  const { client, request } = jsonRpcClient(txStatuses[0]);
  request.mockImplementation(rpcStatuses(...txStatuses));
  return {
    client,
    request,
    getTransactionNoCache: vi.spyOn(client, "getTransactionNoCache"),
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
