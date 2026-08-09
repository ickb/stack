import { ccc } from "@ckb-ccc/core";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Error reported when CKB gives a terminal non-committed transaction status. @public */
export class TransactionWaitError extends Error {
  /** Hash of the transaction that reached a terminal status. */
  public readonly txHash: ccc.Hex;
  /** Terminal status reported by the node. */
  public readonly status: string;
  /** Optional rejection reason reported by the node. */
  public readonly reason: string | undefined;
  /** Whether the owning client cache was cleared and rebuilding is safe. */
  public readonly rebuildReady: boolean;

  /** Creates an error from a transaction hash and terminal node status. */
  constructor(
    txHash: ccc.Hex,
    options: ErrorOptions & { status: string; reason?: string; rebuildReady: boolean },
  ) {
    const { status, reason, rebuildReady } = options;
    const detail = reason === undefined ? status : `${status}: ${reason}`;
    super(`Transaction ${txHash} ended with status ${detail}`, options);
    this.name = "TransactionWaitError";
    this.txHash = txHash;
    this.status = status;
    this.reason = reason;
    this.rebuildReady = rebuildReady;
  }
}

/**
 * Waits for a transaction using CCC's parameter order, defaults, return value,
 * confirmation depth, and timeout behavior.
 *
 * @remarks JSON-RPC clients poll `get_transaction` verbosity 1 directly so a
 * status-only rejection is not hidden by CCC's transaction cache. Other client
 * implementations fall back to `getTransaction` and therefore cannot recover a
 * terminal status that the client itself discards. Timeout and abort also apply
 * while awaiting client operations, but CCC transports cannot be cancelled and
 * may finish after this function rejects.
 *
 * @public
 */
// eslint-disable-next-line max-params -- Matches Client.waitTransaction for drop-in migration.
export async function waitTransaction(
  client: ccc.Client,
  txHashLike: ccc.HexLike,
  confirmations = 0,
  timeout = 60_000,
  interval = 2_000,
  signal?: AbortSignal,
): Promise<ccc.ClientTransactionResponse | undefined> {
  signal?.throwIfAborted();
  validateWaitParameters(confirmations, timeout, interval);
  const wait = {
    deadline: Date.now() + timeout,
    signal,
    timeoutError: Number.isFinite(timeout)
      ? new ccc.ErrorClientWaitTransactionTimeout(timeout)
      : undefined,
  };
  const txHash = ccc.hexFrom(txHashLike);

  for (;;) {
    signal?.throwIfAborted();
    const transaction = await getCommittedTransaction(
      client,
      txHash,
      confirmations > 0,
      wait,
    );
    signal?.throwIfAborted();
    if (
      transaction !== undefined &&
      (confirmations === 0 ||
        (await isConfirmed(client, transaction, confirmations, wait)))
    ) {
      signal?.throwIfAborted();
      return transaction;
    }

    signal?.throwIfAborted();
    if (Date.now() + interval >= wait.deadline) {
      throw getTimeoutError(wait);
    }
    await pollingSleep(interval, wait);
  }
}

async function pollingSleep(interval: number, wait: WaitContext): Promise<void> {
  const sleep = Promise.withResolvers<undefined>();
  const cancelTimer = scheduleAt(Date.now() + interval, () => {
    sleep.resolve(undefined);
  });
  await awaitWithinDeadline(async () => sleep.promise, wait, cancelTimer);
}

function validateWaitParameters(
  confirmations: number,
  timeout: number,
  interval: number,
): void {
  if (!Number.isSafeInteger(confirmations) || confirmations < 0) {
    throw new RangeError("confirmations must be a non-negative safe integer");
  }
  if (timeout !== Infinity && (!Number.isSafeInteger(timeout) || timeout < 0)) {
    throw new RangeError("timeout must be a non-negative safe integer or Infinity");
  }
  if (!Number.isSafeInteger(interval) || interval < 0) {
    throw new RangeError("interval must be a non-negative safe integer");
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Transaction wait aborted", { cause: signal.reason });
}

async function getCommittedTransaction(
  client: ccc.Client,
  txHash: ccc.Hex,
  refreshInclusion: boolean,
  wait: WaitContext,
): Promise<ccc.ClientTransactionResponse | undefined> {
  const status = await getTransactionStatus(client, txHash, wait);
  await assertNotRejected(client, txHash, status, wait);
  if (status.status !== "committed") {
    return undefined;
  }

  const response =
    status.response ??
    (await awaitWithinDeadline(
      async () =>
        refreshInclusion && client instanceof ccc.ClientJsonRpc
          ? client.getTransactionNoCache(txHash)
          : client.getTransaction(txHash),
      wait,
    ));
  if (response === undefined) {
    return undefined;
  }
  await assertNotRejected(
    client,
    txHash,
    {
      status: response.status,
      ...(response.reason === undefined ? {} : { reason: response.reason }),
    },
    wait,
  );
  return response.blockNumber === undefined || isPendingStatus(response.status)
    ? undefined
    : response;
}

async function assertNotRejected(
  client: ccc.Client,
  txHash: ccc.Hex,
  status: TransactionStatusRecord,
  wait: WaitContext,
): Promise<void> {
  if (status.status !== "rejected") {
    return;
  }

  const { reason } = status;
  const rebuildReady = await clearCacheForRebuild(client, wait);
  throw new TransactionWaitError(txHash, {
    status: status.status,
    rebuildReady,
    ...(reason === undefined ? {} : { reason }),
  });
}

async function isConfirmed(
  client: ccc.Client,
  transaction: ccc.ClientTransactionResponse,
  confirmations: number,
  wait: WaitContext,
): Promise<boolean> {
  const { blockNumber } = transaction;
  return (
    blockNumber !== undefined &&
    (await awaitWithinDeadline(async () => client.getTipHeader(), wait)).number -
      blockNumber >=
      confirmations
  );
}

interface WaitContext {
  deadline: number;
  signal: AbortSignal | undefined;
  timeoutError: ccc.ErrorClientWaitTransactionTimeout | undefined;
}

interface TransactionStatusRecord {
  status: string | undefined;
  reason?: string;
  response?: ccc.ClientTransactionResponse;
}

async function getTransactionStatus(
  client: ccc.Client,
  txHash: ccc.Hex,
  wait: WaitContext,
): Promise<TransactionStatusRecord> {
  if (client instanceof ccc.ClientJsonRpc) {
    const response = await awaitWithinDeadline(
      async () => client.requestor.request("get_transaction", [txHash, "0x1"]),
      wait,
    );
    return rawTransactionStatus(response);
  }

  const response = await awaitWithinDeadline(
    async () => client.getTransaction(txHash),
    wait,
  );
  return response === undefined
    ? { status: undefined }
    : {
        status: response.status,
        ...(response.reason === undefined ? {} : { reason: response.reason }),
        response,
      };
}

function rawTransactionStatus(response: unknown): TransactionStatusRecord {
  if (
    typeof response !== "object" ||
    response === null ||
    !("tx_status" in response) ||
    typeof response.tx_status !== "object" ||
    response.tx_status === null
  ) {
    return { status: undefined };
  }

  const { tx_status: statusRecord } = response;
  const status = "status" in statusRecord ? statusRecord.status : undefined;
  const reason = "reason" in statusRecord ? statusRecord.reason : undefined;
  return {
    status: typeof status === "string" ? status : undefined,
    ...(typeof reason === "string" ? { reason } : {}),
  };
}

function isPendingStatus(status: string): boolean {
  return status === "sent" || status === "pending" || status === "proposed";
}

async function clearCacheForRebuild(
  client: ccc.Client,
  wait: WaitContext,
): Promise<boolean> {
  try {
    await awaitWithinDeadline(async () => client.cache.clear(), wait);
    return true;
  } catch (error) {
    if (wait.signal?.aborted === true) {
      throw error;
    }
    return false;
  }
}

async function awaitWithinDeadline<T>(
  operation: () => PromiseLike<T>,
  wait: WaitContext,
  cancel?: () => void,
): Promise<T> {
  const { deadline, signal } = wait;
  signal?.throwIfAborted();
  if (deadline <= Date.now()) {
    throw getTimeoutError(wait);
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let cancelTimeout: (() => void) | undefined;
    function settle(): boolean {
      if (settled) {
        return false;
      }
      settled = true;
      cancelTimeout?.();
      signal?.removeEventListener("abort", onAbort);
      cancel?.();
      return true;
    }
    function onAbort(): void {
      if (signal !== undefined && settle()) {
        reject(abortReason(signal));
      }
    }
    function onTimeout(): void {
      if (settle()) {
        reject(getTimeoutError(wait));
      }
    }
    function onFulfilled(value: T): void {
      if (signal?.aborted === true) {
        onAbort();
      } else if (deadline <= Date.now()) {
        onTimeout();
      } else {
        settle();
        resolve(value);
      }
    }
    function onRejected(error: unknown): void {
      if (signal?.aborted === true) {
        onAbort();
      } else if (deadline <= Date.now()) {
        onTimeout();
      } else {
        settle();
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve the client rejection unchanged.
        reject(error);
      }
    }
    if (Number.isFinite(deadline)) {
      cancelTimeout = scheduleAt(deadline, onTimeout);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted === true) {
      onAbort();
      return;
    }

    void Promise.resolve(operation()).then(onFulfilled, onRejected);
  });
}

function scheduleAt(time: number, callback: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  function arm(): void {
    const remaining = time - Date.now();
    timer = setTimeout(
      () => {
        timer = undefined;
        if (time <= Date.now()) {
          callback();
        } else {
          arm();
        }
      },
      Math.max(0, Math.min(remaining, MAX_TIMER_DELAY_MS)),
    );
  }
  arm();
  return () => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
}

function getTimeoutError(wait: WaitContext): ccc.ErrorClientWaitTransactionTimeout {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Infinite waits have no deadline and cannot reach a timeout path.
  return wait.timeoutError!;
}
