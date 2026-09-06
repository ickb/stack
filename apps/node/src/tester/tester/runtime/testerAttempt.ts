import type { ccc } from "@ckb-ccc/core";
import {
  convert,
  ICKB_DEPOSIT_CAP,
  signAndSendTransaction,
  TransactionBroadcastError,
  TransactionWaitError,
  waitTransaction,
} from "@ickb/sdk";

import { formatCkb } from "../../../shared/index.ts";
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
  type ExecutionLog,
  type TesterBalanceLog,
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
  const log = executionLog;
  log.balance = testerBalanceLog(state, totalEquivalentCkb);
  log.ratio = state.system.exchangeRatio;
  const skip = await freshMatchableOrderSkip(
    runtime,
    state.userOrders,
    state.system.tip,
    { feeRate: state.system.feeRate },
  );
  if (skip !== undefined) {
    log.skip = skip;
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
  });
  if (planned === undefined) {
    return;
  }
  await sendTesterAttempt({ runtime, state, testerScenario, planned, executionLog });
}
function testerBalanceLog(
  state: TesterState,
  totalEquivalentCkb: bigint,
): TesterBalanceLog {
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
  executionLog,
}: {
  runtime: Runtime;
  state: TesterState;
  testerScenario: TesterScenarioSelection;
  planned: PlannedTesterAttempt;
  executionLog: ExecutionLog;
}): Promise<void> {
  const log = executionLog;
  const tx = planned.built.tx;
  const reserveSkip = testerReserveAttemptSkip(
    testerScenario,
    state,
    runtime.accountLocks,
    planned,
  );
  if (reserveSkip !== undefined) {
    log.skip = reserveSkip;
    return;
  }
  const fields = testerAttemptLogFields(testerScenario, state, planned);
  let txHash: ccc.Hex;
  try {
    txHash = await signAndSendTransaction(runtime.signer, tx, (hash) => {
      log.actions = fields.actions;
      log.transactionShape = fields.transactionShape;
      log.txFee = fields.txFeeLog;
      log.txHash = hash;
    });
  } catch (error) {
    if (!(error instanceof TransactionBroadcastError)) {
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
