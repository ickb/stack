import { sleep as cccSleep, type ccc } from "@ckb-ccc/core";
import { TransactionConfirmationError } from "./send_and_wait_error.ts";

/**
 * Options for broadcasting a transaction and polling until commitment.
 *
 * @public
 */
export interface SendAndWaitForCommitOptions {
  /** Maximum status checks before timing out. */
  maxConfirmationChecks?: number;

  /** Delay between pending status checks. */
  confirmationIntervalMs?: number;

  /** Called after broadcast succeeds with the transaction hash. */
  onSent?: (txHash: ccc.Hex) => void;

  /** Called before each configured confirmation wait. */
  onConfirmationWait?: () => void;

  /** Called for broadcast, commit, timeout, unresolved, and terminal rejection events. */
  onLifecycle?: (event: SendAndWaitForCommitEvent) => void;

  /** Optional sleep implementation for tests or custom runtimes. */
  sleep?: (ms: number) => Promise<unknown>;
}

/**
 * Lifecycle events emitted while a sent transaction is waiting for commitment.
 *
 * @public
 */
export type SendAndWaitForCommitEvent =
  | {
      type: "pre_broadcast_failed";
      error: unknown;
      elapsedMs: number;
    }
  | {
      type: "broadcasted";
      txHash: ccc.Hex;
      elapsedMs: number;
    }
  | {
      type: "committed";
      txHash: ccc.Hex;
      status: "committed";
      checks: number;
      elapsedMs: number;
    }
  | {
      type: "timeout_after_broadcast";
      txHash: ccc.Hex;
      status: string | undefined;
      checks: number;
      elapsedMs: number;
    }
  | {
      type: "post_broadcast_unresolved";
      txHash: ccc.Hex;
      status: string | undefined;
      checks: number;
      elapsedMs: number;
      error?: unknown;
    }
  | {
      type: "terminal_rejection";
      txHash: ccc.Hex;
      status: string | undefined;
      reason?: string;
      checks: number;
      elapsedMs: number;
    };

interface TransactionStatusPoll {
  status: string | undefined;
  reason?: string;
}

interface TransactionConfirmationPoll extends TransactionStatusPoll {
  checks: number;
  lastPollingError?: unknown;
}

interface JsonRpcRequestor {
  request: (method: string, params: unknown[]) => Promise<unknown>;
}

interface MaybeJsonRpcClient {
  requestor?: unknown;
}

/**
 * Sends a transaction and waits until CKB reports a committed or terminal status.
 *
 * @remarks Lifecycle callbacks are observation-only: callback failures are ignored
 * and do not change send or confirmation behavior. Pending poll failures keep the
 * transaction in the wait loop until timeout.
 *
 * @throws TransactionConfirmationError-shaped error when the transaction times
 * out after broadcast or reaches a terminal non-committed status. The error has
 * `name`, `txHash`, `status`, `isTimeout`, and optional `reason` fields.
 *
 * @public
 */
export async function sendAndWaitForCommit(
  { client, signer }: { client: ccc.Client; signer: ccc.Signer },
  tx: ccc.Transaction,
  {
    maxConfirmationChecks = 60,
    confirmationIntervalMs = 10_000,
    onSent,
    onConfirmationWait,
    onLifecycle,
    sleep = cccSleep,
  }: SendAndWaitForCommitOptions = {},
): Promise<ccc.Hex> {
  const startedAt = Date.now();
  const requestor = transactionStatusRequestor(client);
  const txHash = await sendTransactionWithLifecycle(signer, tx, onLifecycle, startedAt);
  onSent?.(txHash);
  notifyLifecycle(onLifecycle, {
    type: "broadcasted",
    txHash,
    elapsedMs: Date.now() - startedAt,
  });
  const poll = await waitForTransactionStatus(client, requestor, txHash, {
    maxConfirmationChecks,
    confirmationIntervalMs,
    onConfirmationWait,
    sleep,
  });

  if (poll.status === "committed") {
    notifyLifecycle(onLifecycle, {
      type: "committed",
      txHash,
      status: poll.status,
      checks: poll.checks,
      elapsedMs: Date.now() - startedAt,
    });
    return txHash;
  }

  throw confirmationFailure(txHash, poll, onLifecycle, startedAt);
}

async function sendTransactionWithLifecycle(
  signer: ccc.Signer,
  tx: ccc.Transaction,
  onLifecycle: SendAndWaitForCommitOptions["onLifecycle"] | undefined,
  startedAt: number,
): Promise<ccc.Hex> {
  try {
    return await signer.sendTransaction(tx);
  } catch (error) {
    notifyLifecycle(onLifecycle, {
      type: "pre_broadcast_failed",
      error,
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
}

async function waitForTransactionStatus(
  client: ccc.Client,
  requestor: JsonRpcRequestor,
  txHash: ccc.Hex,
  options: Required<
    Pick<
      SendAndWaitForCommitOptions,
      "maxConfirmationChecks" | "confirmationIntervalMs" | "sleep"
    >
  > &
    Pick<SendAndWaitForCommitOptions, "onConfirmationWait">,
): Promise<TransactionConfirmationPoll> {
  let status: string | undefined = "sent";
  let reason: string | undefined;
  let lastPollingError: unknown;
  let checks = 0;
  while (checks < options.maxConfirmationChecks && isPendingStatus(status)) {
    ({ status, reason, lastPollingError } = await pollTransactionStatus(
      client,
      requestor,
      txHash,
    ));
    checks += 1;
    if (!isPendingStatus(status) || checks >= options.maxConfirmationChecks) {
      break;
    }
    options.onConfirmationWait?.();
    await options.sleep(options.confirmationIntervalMs);
  }
  return {
    status,
    ...(reason === undefined ? {} : { reason }),
    checks,
    lastPollingError,
  };
}

async function pollTransactionStatus(
  client: ccc.Client,
  requestor: JsonRpcRequestor,
  txHash: ccc.Hex,
): Promise<TransactionStatusPoll & { lastPollingError?: unknown }> {
  try {
    const poll = await getTransactionStatus(requestor, txHash);
    if (poll.status === "rejected") {
      await client.cache.clear();
    }
    return poll;
  } catch (error) {
    return { status: "sent", lastPollingError: error };
  }
}

function confirmationFailure(
  txHash: ccc.Hex,
  poll: TransactionConfirmationPoll,
  onLifecycle: SendAndWaitForCommitOptions["onLifecycle"] | undefined,
  startedAt: number,
): TransactionConfirmationError {
  if (isPendingStatus(poll.status)) {
    notifyLifecycle(onLifecycle, unresolvedBroadcastEvent(txHash, poll, startedAt));
    return new TransactionConfirmationError(
      "Transaction confirmation timed out",
      poll.lastPollingError === undefined ? undefined : { cause: poll.lastPollingError },
      txHash,
      poll.status,
      true,
      undefined,
    );
  }

  const status = poll.status;
  notifyLifecycle(onLifecycle, {
    type: "terminal_rejection",
    txHash,
    status,
    ...(poll.reason === undefined ? {} : { reason: poll.reason }),
    checks: poll.checks,
    elapsedMs: Date.now() - startedAt,
  });
  return new TransactionConfirmationError(
    terminalStatusMessage(status, poll.reason),
    undefined,
    txHash,
    status,
    false,
    poll.reason,
  );
}

function unresolvedBroadcastEvent(
  txHash: ccc.Hex,
  poll: TransactionConfirmationPoll,
  startedAt: number,
): SendAndWaitForCommitEvent {
  return {
    type:
      poll.lastPollingError === undefined
        ? "timeout_after_broadcast"
        : "post_broadcast_unresolved",
    txHash,
    status: poll.status,
    checks: poll.checks,
    elapsedMs: Date.now() - startedAt,
    ...(poll.lastPollingError === undefined ? {} : { error: poll.lastPollingError }),
  };
}

function terminalStatusMessage(status: string, reason: string | undefined): string {
  const message = `Transaction ended with status: ${status}`;
  return reason === undefined ? message : `${message}: ${reason}`;
}

function transactionStatusRequestor({
  requestor,
}: ccc.Client & MaybeJsonRpcClient): JsonRpcRequestor {
  if (!isJsonRpcRequestor(requestor)) {
    throw new TypeError("sendAndWaitForCommit requires a JSON-RPC client requestor");
  }
  return requestor;
}

function isJsonRpcRequestor(value: unknown): value is JsonRpcRequestor {
  return (
    typeof value === "object" &&
    value !== null &&
    "request" in value &&
    typeof value.request === "function"
  );
}

async function getTransactionStatus(
  requestor: JsonRpcRequestor,
  txHash: ccc.Hex,
): Promise<TransactionStatusPoll> {
  const response = await requestor.request("get_transaction", [txHash, "0x1"]);
  if (!isRecord(response)) {
    return { status: undefined };
  }
  const txStatus = response["tx_status"];
  if (!isRecord(txStatus)) {
    return { status: undefined };
  }
  const status = txStatus["status"];
  const reason = txStatus["reason"];
  return {
    status: typeof status === "string" ? status : undefined,
    ...(typeof reason === "string" ? { reason } : {}),
  };
}

function notifyLifecycle(
  onLifecycle: SendAndWaitForCommitOptions["onLifecycle"] | undefined,
  event: SendAndWaitForCommitEvent,
): void {
  try {
    onLifecycle?.(event);
  } catch {
    // Observability callbacks must not change transaction send/confirmation behavior.
  }
}

function isPendingStatus(
  status: string | undefined,
): status is undefined | "sent" | "pending" | "proposed" | "unknown" {
  return (
    status === undefined ||
    status === "sent" ||
    status === "pending" ||
    status === "proposed" ||
    status === "unknown"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
