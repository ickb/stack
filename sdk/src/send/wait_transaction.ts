import { ccc } from "@ckb-ccc/core";
import { jsonRpcRequestor, rawTransactionStatus } from "../utils/utils.ts";

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
  /** Cancels polling and any in-flight client operation. */
  signal?: AbortSignal;
}

/**
 * Observes one already-broadcast transaction for a single bounded window and returns
 * it once the node reports it committed.
 *
 * @remarks Every Stack caller waits at depth zero for one window and then rebuilds
 * from committed state (decisions amendment 45); depth would be an additive option.
 * Clients with a JSON-RPC requestor, the connector's composed client included, poll
 * `get_transaction` verbosity 1 directly so a status-only rejection is not hidden by
 * CCC's transaction cache, and every transaction body read bypasses that cache. Timeout and abort also apply while awaiting client
 * operations, but CCC transports cannot be cancelled and may finish after this
 * function rejects. Nothing here mutates the client cache: later attempts rebuild
 * from exact committed reads.
 */
export async function waitTransaction(
  client: ccc.Client,
  txHashLike: ccc.HexLike,
  options: WaitTransactionOptions = {},
): Promise<ccc.ClientTransactionResponse> {
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
      const committed = await readCommittedTransaction(poll);
      if (committed !== undefined) {
        // An abort synchronized into the gap between the last read and this
        // return must not resolve the wait successfully.
        budget.throwIfStopped();
        return committed;
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

interface TransactionStatus {
  status: string | undefined;
  reason: string | undefined;
  response?: ccc.ClientTransactionResponse;
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
  // CCC transports cannot be cancelled, so a settlement arriving after the
  // window closed must stay handled rather than surface as an unhandled one.
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

async function readCommittedTransaction(
  poll: WaitPoll,
): Promise<ccc.ClientTransactionResponse | undefined> {
  const status = await readTransactionStatus(poll);
  assertNotRejected(poll.txHash, status);
  if (status.status !== "committed") {
    return undefined;
  }

  const response = status.response ?? (await readTransactionBody(poll));
  if (response === undefined) {
    return undefined;
  }
  assertNotRejected(poll.txHash, {
    status: response.status,
    reason: response.reason,
  });
  // Only a body that itself reports commitment counts: an uncached read may lag
  // or disagree with the status poll, and any other status is not commitment.
  return response.status === "committed" && response.blockNumber !== undefined
    ? response
    : undefined;
}

async function readTransactionStatus(poll: WaitPoll): Promise<TransactionStatus> {
  const { client, txHash, budget } = poll;
  const requestor = jsonRpcRequestor(client);
  if (requestor !== undefined) {
    // Raw verbosity-1 polling keeps a status-only rejection that CCC's typed
    // transaction response discards (its body is null, so CCC returns nothing).
    return rawTransactionStatus(
      await within(
        async () => requestor.request("get_transaction", [txHash, "0x1"]),
        budget,
      ),
    );
  }

  const response = await readTransactionBody(poll);
  return response === undefined
    ? { status: undefined, reason: undefined }
    : { status: response.status, reason: response.reason, response };
}

async function readTransactionBody(
  poll: WaitPoll,
): Promise<ccc.ClientTransactionResponse | undefined> {
  const response = await within(
    async () => poll.client.getTransactionNoCache(poll.txHash),
    poll.budget,
  );
  if (response === undefined) {
    return undefined;
  }
  try {
    // A generic client may return an unvalidated shape, and a body that cannot
    // be normalized is not evidence of commitment: keep the window polling.
    return ccc.ClientTransactionResponse.from(response);
  } catch {
    return undefined;
  }
}

function assertNotRejected(txHash: ccc.Hex, status: TransactionStatus): void {
  if (status.status === "rejected") {
    throw new TransactionWaitError(txHash, {
      status: status.status,
      reason: status.reason,
    });
  }
}
