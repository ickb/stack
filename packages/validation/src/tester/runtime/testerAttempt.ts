import type { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP, convert } from "@ickb/core";
import { formatCkb } from "@ickb/node-utils";
import {
  TransactionBroadcastError,
  TransactionWaitError,
  signAndSendTransaction,
  waitTransaction,
} from "@ickb/sdk";
import {
  testerAttemptLogFields,
  testerReserveAttemptSkip,
} from "../evidence/testerAttemptEvidence.ts";
import {
  planTesterAttempt,
  type PlannedTesterAttempt,
} from "../planning/testerAttemptPlanning.ts";
import { freshMatchableOrderSkip } from "./freshMatchableOrderSkip.ts";
import { readTesterState, type Runtime, type TesterState } from "./runtime.ts";
import {
  CKB_RESERVE,
  createExecutionLogWriter,
  type ExecutionLog,
  type ExecutionLogWriter,
  type TesterFeePolicy,
  type TesterScenarioSelection,
} from "./testerTypes.ts";
const VALIDATION_TRANSACTION_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Reads state, plans one tester action, applies reserve checks, and sends when actionable.
 */
export async function runTesterAttempt({
  runtime,
  testerScenario,
  feePolicy,
  executionLog,
}: {
  runtime: Runtime;
  testerScenario: TesterScenarioSelection;
  feePolicy: TesterFeePolicy;
  executionLog: ExecutionLog;
}): Promise<void> {
  const state = await readTesterState(runtime);
  const depositCapacity = convert(false, ICKB_DEPOSIT_CAP, state.system.exchangeRatio);
  const totalEquivalentCkb =
    state.totalCkbBalance +
    convert(false, state.totalIckbBalance, state.system.exchangeRatio);
  const executionLogWriter = createExecutionLogWriter(executionLog);
  executionLogWriter.record({
    balance: testerBalanceLog(state, totalEquivalentCkb),
    ratio: state.system.exchangeRatio,
  });
  const skip = await freshMatchableOrderSkip(
    runtime,
    state.userOrders,
    state.system.tip,
    { feeRate: state.system.feeRate },
  );
  if (skip !== undefined) {
    executionLogWriter.record({ skip });
    return;
  }
  const planned = await planTesterAttempt({
    runtime,
    state,
    testerScenario,
    feePolicy,
    depositCapacity,
    totalEquivalentCkb,
    executionLog,
    executionLogWriter,
  });
  if (planned === undefined) {
    return;
  }
  await sendTesterAttempt({
    runtime,
    state,
    testerScenario,
    planned,
    executionLogWriter,
  });
}
function testerBalanceLog(
  state: TesterState,
  totalEquivalentCkb: bigint,
): Record<string, unknown> {
  return {
    CKB: {
      total: formatCkb(state.totalCkbBalance),
      available: formatCkb(state.availableCkbBalance),
      plainAvailable: formatCkb(state.plainCkbBalance),
      projectedAvailable: formatCkb(state.availableCkbBalance),
      reserve: formatCkb(CKB_RESERVE),
      unavailable: formatCkb(state.pendingCkbBalance),
    },
    ICKB: {
      total: formatCkb(state.totalIckbBalance),
      available: formatCkb(state.availableIckbBalance),
      unavailable: formatCkb(state.pendingIckbBalance),
    },
    totalEquivalent: {
      CKB: formatCkb(totalEquivalentCkb),
      ICKB: formatCkb(
        convert(true, state.totalCkbBalance, state.system.exchangeRatio) +
          state.totalIckbBalance,
      ),
    },
  };
}
async function sendTesterAttempt({
  runtime,
  state,
  testerScenario,
  planned,
  executionLogWriter,
}: {
  runtime: Runtime;
  state: TesterState;
  testerScenario: TesterScenarioSelection;
  planned: PlannedTesterAttempt;
  executionLogWriter: ExecutionLogWriter;
}): Promise<void> {
  const tx = planned.built.tx;
  const reserveSkip = testerReserveAttemptSkip(
    testerScenario,
    state,
    runtime.accountLocks,
    planned,
  );
  if (reserveSkip !== undefined) {
    executionLogWriter.record({ skip: reserveSkip });
    return;
  }
  const fields = testerAttemptLogFields(testerScenario, state, planned);
  let txHash: ccc.Hex;
  try {
    txHash = await signAndSendTransaction(runtime.signer, tx, (hash) => {
      executionLogWriter.record({
        actions: fields.actions,
        transactionShape: fields.transactionShape,
        txFee: fields.txFeeLog,
        txHash: hash,
      });
    });
  } catch (error) {
    if (!(error instanceof TransactionBroadcastError) || error.nodeTxHash !== undefined) {
      throw error;
    }
    txHash = error.txHash;
  }
  try {
    await waitTransaction(runtime.signer.client, txHash, {
      timeout: VALIDATION_TRANSACTION_TIMEOUT_MS,
    });
  } catch (error) {
    throw testerTransactionConfirmationError(error, txHash);
  }
}

interface TransactionConfirmationErrorOptions {
  cause?: unknown;
  isTimeout: boolean;
  reason?: string;
  status: string;
  txHash: ccc.Hex;
}

class TransactionConfirmationError extends Error {
  public readonly isTimeout: boolean;
  public readonly reason: string | undefined;
  public readonly status: string;
  public readonly txHash: ccc.Hex;

  constructor(message: string, options: TransactionConfirmationErrorOptions) {
    super(message, options);
    this.name = "TransactionConfirmationError";
    this.isTimeout = options.isTimeout;
    this.reason = options.reason;
    this.status = options.status;
    this.txHash = options.txHash;
  }
}

function testerTransactionConfirmationError(
  error: unknown,
  txHash: ccc.Hex,
): TransactionConfirmationError {
  if (error instanceof TransactionWaitError) {
    return new TransactionConfirmationError(error.message, {
      txHash,
      status: error.status,
      isTimeout: false,
      reason: error.reason,
    });
  }
  // A closed window leaves the attempt unresolved rather than rejected.
  return new TransactionConfirmationError("Transaction status remained unresolved", {
    txHash,
    status: "sent",
    isTimeout: true,
    cause: error,
  });
}
