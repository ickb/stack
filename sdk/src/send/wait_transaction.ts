import { ccc } from "@ckb-ccc/core";
import { jsonRpcRequestor } from "../utils/utils.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_INTERVAL_MS = 2_000;

/**
 * A wait's outcome. `rejected`: the node reported the transaction rejected, `detail` its
 * reason when it gave one. `timed-out`: the window closed with the transaction neither
 * committed nor rejected; it may still confirm, so the same hash can be watched again.
 */
export type WaitTransactionResult =
  | { ok: true }
  | { ok: false; reason: "rejected"; detail: string | undefined }
  | { ok: false; reason: "timed-out" };

/** One bounded observation window for an already-broadcast transaction. */
export interface WaitTransactionOptions {
  /** Absolute budget in milliseconds for the whole wait. Defaults to 60000. */
  timeout?: number;
  /** Delay in milliseconds between polls. Defaults to 2000. */
  interval?: number;
  /**
   * Stops waiting, including on in-flight operations, by rejecting with the signal's own
   * reason, whatever it is; their transports may still finish.
   */
  signal?: AbortSignal;
}

/**
 * Observes one already-broadcast transaction for a single bounded window: it resolves
 * `ok` once the node reports it committed, `rejected` once the node reports it rejected,
 * and `timed-out` when the window closes first. A caller's abort throws its signal's reason.
 *
 * @remarks Stack waits at depth zero. Actors rebuild next turn; the app can reopen a
 * window on the same hash without signing again. Callers needing deeper confirmation
 * must observe it separately.
 * The status is polled with raw `get_transaction` verbosity 1, since CCC's typed response
 * discards a null transaction body and its rejection status; the client must be JSON-RPC,
 * the connector's composed client included. The body is never read: no caller uses it,
 * and the same node's word on it would verify nothing.
 * Timeout and abort also apply while awaiting client
 * operations, but the in-flight client operation receives no abort signal and may
 * finish after this function rejects. Nothing here mutates the client cache: later attempts rebuild
 * from exact committed reads.
 */
export async function waitTransaction(
  client: ccc.Client,
  txHashLike: ccc.HexLike,
  options: WaitTransactionOptions = {},
): Promise<WaitTransactionResult> {
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    interval = DEFAULT_INTERVAL_MS,
    signal,
  } = options;
  validateWaitOptions(timeout, interval);
  // Normalized before the window opens so a malformed hash cannot leave a timer
  // or abort listener installed outside the try/finally that closes them.
  const txHash = ccc.hexFrom(txHashLike);
  signal?.throwIfAborted();

  const budget = openWaitWindow(timeout, signal);
  try {
    for (;;) {
      const { status, reason } = await transactionStatus(client, txHash, budget);
      if (status === "rejected") {
        return { ok: false, reason: "rejected", detail: reason };
      }
      if (status === "committed") {
        // An abort synchronized into the gap between the last read and this
        // return must not resolve the wait successfully.
        budget.throwIfStopped();
        return { ok: true };
      }
      if (Date.now() + interval >= budget.deadline) {
        throw budget.timedOut;
      }
      await pollingSleep(interval, budget);
    }
  } catch (error) {
    // The window's own timeout, by identity; a read failure or the caller's abort rethrows.
    if (error === budget.timedOut) {
      return { ok: false, reason: "timed-out" };
    }
    throw error;
  } finally {
    budget.close();
  }
}

interface WaitWindow {
  deadline: number;
  timedOut: Error;
  stopped: Promise<never>;
  throwIfStopped: () => void;
  close: () => void;
}

function validateWaitOptions(timeout: number, interval: number): void {
  assertCount(interval, "interval");
  assertCount(timeout, "timeout");
  // A single unarmed timer owns the whole window, so the budget must fit one.
  if (timeout > MAX_TIMEOUT_MS) {
    throw new RangeError(`timeout must not exceed ${String(MAX_TIMEOUT_MS)} ms`);
  }
}

function assertCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function openWaitWindow(timeout: number, signal: AbortSignal | undefined): WaitWindow {
  const stop = Promise.withResolvers<never>();
  // Never surfaced: the wait catches it by identity and returns `timed-out`.
  const timedOut = new Error("The wait window closed");
  const timer = setTimeout(() => {
    stop.reject(timedOut);
  }, timeout);
  const onAbort = (): void => {
    stop.reject(signal?.reason);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  // Only the operation currently racing this window consumes its rejection.
  void stop.promise.catch(ignoreSettlement);
  return {
    deadline: Date.now() + timeout,
    timedOut,
    stopped: stop.promise,
    throwIfStopped: (): void => {
      // Only a promise currently racing the window observes its rejection, so
      // an abort landing outside a race has to be read from the signal itself.
      signal?.throwIfAborted();
    },
    close: (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function ignoreSettlement(): void {
  // Deliberately empty: the racing caller owns the outcome.
}

async function within<T>(operation: () => Promise<T>, budget: WaitWindow): Promise<T> {
  if (Date.now() >= budget.deadline) {
    throw budget.timedOut;
  }
  const running = operation();
  // The operation is not cancelled, so a settlement arriving after the window
  // closed must stay handled rather than surface as an unhandled one.
  void running.catch(ignoreSettlement);
  const result = await Promise.race([running, budget.stopped]);
  // An operation that settles in the same turn as an abort can win the race, so
  // cancellation is decided before the result is accepted.
  budget.throwIfStopped();
  // An operation that blocks the event loop past the deadline starves the
  // window timer, so its overdue result must not win the race.
  if (Date.now() >= budget.deadline) {
    throw budget.timedOut;
  }
  return result;
}

async function pollingSleep(interval: number, budget: WaitWindow): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sleeping = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, interval);
  });
  try {
    await Promise.race([sleeping, budget.stopped]);
  } finally {
    clearTimeout(timer);
  }
}

async function transactionStatus(
  client: ccc.Client,
  txHash: ccc.Hex,
  budget: WaitWindow,
): Promise<ReturnType<typeof rawTransactionStatus>> {
  const requestor = jsonRpcRequestor(client);
  // Raw verbosity-1 polling keeps a status-only rejection that CCC's typed transaction
  // response discards (its body is null, so CCC returns nothing).
  return rawTransactionStatus(
    await within(
      async () => requestor.request("get_transaction", [txHash, "0x1"]),
      budget,
    ),
  );
}

/** A node's raw `get_transaction` status record (verbosity 1), the fields read here. */
function rawTransactionStatus(response: unknown): {
  status: string | undefined;
  reason: string | undefined;
} {
  const record =
    typeof response === "object" &&
    response !== null &&
    "tx_status" in response &&
    typeof response.tx_status === "object" &&
    response.tx_status !== null
      ? response.tx_status
      : {};
  return {
    status:
      "status" in record && typeof record.status === "string" ? record.status : undefined,
    reason:
      "reason" in record && typeof record.reason === "string" ? record.reason : undefined,
  };
}
