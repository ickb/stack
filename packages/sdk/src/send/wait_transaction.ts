import { ccc } from "@ckb-ccc/core";

const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_INTERVAL_MS = 2_000;

/** Error reported when CKB gives a terminal non-committed transaction status. @public */
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

/** One bounded observation window for an already-broadcast transaction. @public */
export interface WaitTransactionOptions {
  /**
   * Canonical depth below the tip required before returning. Defaults to 0.
   *
   * @remarks A positive depth fails closed: the inclusion recheck needs both the
   * block number and the block hash, so a client whose committed response omits
   * `blockHash` never confirms and the wait ends at its timeout.
   */
  confirmations?: number;
  /** Absolute budget in milliseconds for the whole wait. Defaults to 60000. */
  timeout?: number;
  /** Delay in milliseconds between polls. Defaults to 2000. */
  interval?: number;
  /** Cancels polling and any in-flight client operation. */
  signal?: AbortSignal;
}

/**
 * Arguments accepted after the client and the transaction hash.
 *
 * @remarks Exactly one call form per call: the options object, or the shipped
 * positional arguments. Mixing them is rejected at compile time.
 *
 * @public
 */
export type WaitTransactionArguments =
  | [options: WaitTransactionOptions]
  | [confirmations?: number, timeout?: number, interval?: number, signal?: AbortSignal];

/**
 * Observes one already-broadcast transaction for a single bounded window.
 *
 * @remarks Accepts `(client, txHash, options)` or the shipped positional
 * `(client, txHash, confirmations?, timeout?, interval?, signal?)`. JSON-RPC
 * clients poll `get_transaction` verbosity 1 directly so a status-only
 * rejection is not hidden by CCC's transaction cache, and every transaction
 * body read bypasses that cache. Timeout and abort also apply while awaiting
 * client operations, but CCC transports cannot be cancelled and may finish
 * after this function rejects. Nothing here mutates the client cache: later
 * attempts rebuild from exact committed reads.
 *
 * @public
 */
export async function waitTransaction(
  client: ccc.Client,
  txHashLike: ccc.HexLike,
  ...args: WaitTransactionArguments
): Promise<ccc.ClientTransactionResponse> {
  const {
    confirmations = 0,
    timeout = DEFAULT_TIMEOUT_MS,
    interval = DEFAULT_INTERVAL_MS,
    signal,
  } = waitOptions(args);
  validateWaitOptions(confirmations, timeout, interval);
  // Normalized before the window opens so a malformed hash cannot leave a timer
  // or abort listener installed outside the try/finally that closes them.
  const txHash = ccc.hexFrom(txHashLike);
  signal?.throwIfAborted();

  const budget = openWaitWindow(timeout, signal);
  const poll = { client, txHash, budget };
  try {
    for (;;) {
      const committed = await readCommittedTransaction(poll);
      if (
        committed !== undefined &&
        (confirmations === 0 || (await isConfirmed(poll, committed, confirmations)))
      ) {
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

function waitOptions(args: WaitTransactionArguments): WaitTransactionOptions {
  if (isOptionsForm(args)) {
    return args[0];
  }
  const [confirmations, timeout, interval, signal] = args;
  return { confirmations, timeout, interval, signal };
}

function isOptionsForm(
  args: WaitTransactionArguments,
): args is [options: WaitTransactionOptions] {
  // The positional form is shipped public API, so anything that is not an
  // options object is read as `confirmations` rather than defaulting to zero.
  return typeof args[0] === "object";
}

function validateWaitOptions(
  confirmations: number,
  timeout: number,
  interval: number,
): void {
  assertCount(confirmations, "confirmations");
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
  if (client instanceof ccc.ClientJsonRpc) {
    // Raw verbosity-1 polling keeps a status-only rejection that CCC's cached
    // transaction response discards.
    return rawTransactionStatus(
      await within(
        async () => client.requestor.request("get_transaction", [txHash, "0x1"]),
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

async function isConfirmed(
  poll: WaitPoll,
  committed: ccc.ClientTransactionResponse,
  confirmations: number,
): Promise<boolean> {
  const tip = await within(async () => poll.client.getTipHeader(), poll.budget);
  if (
    committed.blockNumber === undefined ||
    tip.number - committed.blockNumber < confirmations
  ) {
    return false;
  }

  // Depth below a tip is not inclusion: re-read without cache so a reorg that
  // moved or dropped the transaction cannot be reported as confirmed.
  const current = await readCommittedTransaction(poll);
  if (current === undefined) {
    return false;
  }
  return (
    committed.blockHash !== undefined &&
    current.blockNumber === committed.blockNumber &&
    current.blockHash === committed.blockHash
  );
}

function rawTransactionStatus(response: unknown): TransactionStatus {
  if (
    typeof response !== "object" ||
    response === null ||
    !("tx_status" in response) ||
    typeof response.tx_status !== "object" ||
    response.tx_status === null
  ) {
    return { status: undefined, reason: undefined };
  }

  const { tx_status: statusRecord } = response;
  const status = "status" in statusRecord ? statusRecord.status : undefined;
  const reason = "reason" in statusRecord ? statusRecord.reason : undefined;
  return {
    status: typeof status === "string" ? status : undefined,
    reason: typeof reason === "string" ? reason : undefined,
  };
}
