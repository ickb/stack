import { ccc } from "@ckb-ccc/core";
import { jsonRpcRequestor } from "../utils/utils.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_INTERVAL_MS = 2_000;

/** Error reported when CKB gives a terminal non-committed transaction status. */
export class TransactionWaitError extends Error {
  /** Hash of the transaction that reached a terminal status. */
  public readonly txHash: ccc.Hex;
  /** Terminal status reported by the node. */
  public readonly status: string;
  /** Optional rejection reason reported by the node. */
  public readonly reason: string | undefined;

  /** Creates an error from a transaction hash and terminal node status. */
  constructor(
    txHash: ccc.Hex,
    options: ErrorOptions & { status: string; reason?: string },
  ) {
    const { status, reason } = options;
    const detail = reason === undefined ? status : `${status}: ${reason}`;
    super(`Transaction ${txHash} ended with status ${detail}`, options);
    this.name = "TransactionWaitError";
    this.txHash = txHash;
    this.status = status;
    this.reason = reason;
  }
}

/** One bounded observation window for an already-broadcast transaction. */
export interface WaitTransactionOptions {
  /** Absolute budget in milliseconds for the whole wait. Defaults to 60000. */
  timeout?: number;
  /** Delay in milliseconds between polls. Defaults to 2000. */
  interval?: number;
  /** Stops waiting, including on in-flight operations; their transports may still finish. */
  signal?: AbortSignal;
}

/**
 * Observes one already-broadcast transaction for a single bounded window and resolves
 * once the node reports it committed.
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
): Promise<void> {
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
  const poll = { client, txHash, budget };
  try {
    for (;;) {
      if (await isCommitted(poll)) {
        // An abort synchronized into the gap between the last read and this
        // return must not resolve the wait successfully.
        budget.throwIfStopped();
        return;
      }
      if (Date.now() + interval >= budget.deadline) {
        throw budget.timeoutError;
      }
      await pollingSleep(interval, budget);
    }
  } finally {
    budget.close();
  }
}

interface WaitWindow {
  deadline: number;
  timeoutError: ccc.ErrorClientWaitTransactionTimeout;
  stopped: Promise<never>;
  throwIfStopped: () => void;
  close: () => void;
}

interface WaitPoll {
  client: ccc.Client;
  txHash: ccc.Hex;
  budget: WaitWindow;
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
  const timeoutError = new ccc.ErrorClientWaitTransactionTimeout(timeout);
  const timer = setTimeout(() => {
    stop.reject(timeoutError);
  }, timeout);
  const onAbort = (): void => {
    stop.reject(abortReason(signal));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  // Only the operation currently racing this window consumes its rejection.
  void stop.promise.catch(ignoreSettlement);
  return {
    deadline: Date.now() + timeout,
    timeoutError,
    stopped: stop.promise,
    throwIfStopped: (): void => {
      // Only a promise currently racing the window observes its rejection, so
      // an abort landing outside a race has to be read from the signal itself.
      if (signal?.aborted === true) {
        throw abortReason(signal);
      }
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

function abortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("Transaction wait aborted", { cause: signal?.reason });
}

async function within<T>(operation: () => Promise<T>, budget: WaitWindow): Promise<T> {
  if (Date.now() >= budget.deadline) {
    throw budget.timeoutError;
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
    throw budget.timeoutError;
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

async function isCommitted(poll: WaitPoll): Promise<boolean> {
  const { client, txHash, budget } = poll;
  const requestor = jsonRpcRequestor(client);
  // Raw verbosity-1 polling keeps a status-only rejection that CCC's typed transaction
  // response discards (its body is null, so CCC returns nothing).
  const { status, reason } = rawTransactionStatus(
    await within(
      async () => requestor.request("get_transaction", [txHash, "0x1"]),
      budget,
    ),
  );
  if (status === "rejected") {
    throw new TransactionWaitError(txHash, { status, reason });
  }
  return status === "committed";
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
