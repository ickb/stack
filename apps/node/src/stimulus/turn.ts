import { ccc } from "@ckb-ccc/core";
import {
  type ConversionMetadata,
  IckbSdk,
  isIckbError,
  OrderConversionRepresentabilityError,
  postTransactionAccountPlainCkbBalance,
  signAndSendTransaction,
  TransactionBroadcastError,
  TransactionWaitError,
  waitTransaction,
} from "@ickb/sdk";
import {
  type ChainPreflightEvidence,
  formatCkb,
  logExecution,
  type PublicRpcEndpointIdentity,
  STOP_EXIT_CODE,
} from "../shared/index.ts";
import { type Draw, drawTurn, ORDER_FEE_BASE, type Override } from "./draw.ts";
import {
  CKB_RESERVE,
  readStimulusState,
  type Runtime,
  type StimulusState,
} from "./state.ts";

/** Public identity of the stimulus process: who acted, on which chain, through which endpoint. */
export interface StimulusIdentity {
  chain: "testnet";
  address: string;
  primaryLock: { codeHash: ccc.Hex; hashType: ccc.HashType; args: ccc.Hex };
  rpcEndpoint: PublicRpcEndpointIdentity;
  preflight: Omit<ChainPreflightEvidence, "chain">;
}

/** Every way a turn ends; `committed` is the only one that proves stimulus reached the chain. */
export type Outcome =
  "committed" | "unresolved" | "rejected" | "skipped" | "hold" | "failed";

export type Skip =
  | { reason: "capital-below-minimum"; deficit: string }
  | { reason: "nothing-to-spend" }
  | { reason: "unrepresentable-amount" }
  | { reason: "unfundable"; error: unknown }
  | { reason: "conversion-not-buildable"; conversion: string }
  | {
      reason: "post-tx-ckb-reserve";
      reserve: string;
      preTxCkbBalance: string;
      postTxCkbBalance: string;
    };

/** Order and master output positions, or the SDK's conversion kind, of the sent transaction. */
export type Action =
  { order: { outputs: [number, number] } } | { conversion: ConversionMetadata };

/** The one JSON record a turn writes; fields fill in as the turn advances. */
export interface StimulusLog {
  identity?: StimulusIdentity;
  startTime?: string;
  balance?: {
    CKB: { total: string; plain: string; budget: string; reserve: string };
    ICKB: { total: string; budget: string };
    totalEquivalentCkb: string;
    capitalMinimum: string;
  };
  orders?: StimulusState["orders"];
  draw?: Draw | { kind: "collect-only" };
  outcome?: Outcome;
  skip?: Skip;
  action?: Action;
  transactionShape?: {
    inputs: number;
    outputs: number;
    cellDeps: number;
    witnesses: number;
  };
  txFee?: { fee: string; feeRate: ccc.Num };
  txHash?: ccc.Hex;
  error?: unknown;
}

type Built = { tx: ccc.Transaction; action: Action } | { skip: Skip };
/** Appends fields to the turn's log line. */
type Record = (fields: Partial<StimulusLog>) => void;

const WAIT_TIMEOUT_MS = 10 * 60 * 1000;

/** Runs one turn, writes its log line, and leaves the exit code set. */
export async function runStimulusTurn({
  runtime,
  identity,
  override,
  random,
}: {
  runtime: Runtime;
  identity: StimulusIdentity;
  override: Override;
  random: () => number;
}): Promise<void> {
  const startTime = new Date();
  const log: StimulusLog = { identity, startTime: startTime.toISOString() };
  try {
    await stimulate(runtime, override, random, (fields) => {
      Object.assign(log, fields);
    });
  } catch (error) {
    log.outcome ??= "failed";
    log.error = error;
    process.exitCode = 1;
  }
  logExecution(log, startTime);
}

async function stimulate(
  runtime: Runtime,
  override: Override,
  random: () => number,
  record: Record,
): Promise<void> {
  const state = await readStimulusState(runtime);
  record({ balance: balanceLog(state), orders: state.orders });
  if (state.totalEquivalentCkb < state.capitalMinimum) {
    record({
      outcome: "hold",
      skip: {
        reason: "capital-below-minimum",
        deficit: formatCkb(state.capitalMinimum - state.totalEquivalentCkb),
      },
    });
    process.exitCode = STOP_EXIT_CODE;
    return;
  }
  const draw = drawTurn(state.budgets, override, random);
  record({ draw });
  let built: Built =
    draw === undefined
      ? { skip: { reason: "nothing-to-spend" } }
      : acceptReserve(runtime, state, await build(runtime, state, draw));
  // Whatever stopped the drawn action, collecting what the bot filled keeps the account
  // liquid; the SDK's zero-amount conversion is exactly that transaction.
  if ("skip" in built && state.collectable.length > 0) {
    record({ skip: built.skip, draw: { kind: "collect-only" } });
    built = await buildConversion(runtime, state, "ckb-to-ickb", 0n);
  }
  if ("skip" in built) {
    record({ outcome: "skipped", skip: built.skip });
    return;
  }
  await send(runtime, state, built, record);
}

async function build(runtime: Runtime, state: StimulusState, draw: Draw): Promise<Built> {
  if (draw.kind === "conversion") {
    return buildConversion(runtime, state, draw.direction, draw.amount);
  }
  const isCkb2Udt = draw.direction === "ckb-to-ickb";
  const amounts = isCkb2Udt
    ? { ckbValue: draw.amount, udtValue: 0n }
    : { ckbValue: 0n, udtValue: draw.amount };
  let info: ReturnType<typeof IckbSdk.estimate>["info"];
  try {
    info = IckbSdk.estimate(isCkb2Udt, amounts, state.system, {
      fee: draw.fee,
      feeBase: ORDER_FEE_BASE,
    }).info;
  } catch (error) {
    if (error instanceof OrderConversionRepresentabilityError) {
      return { skip: { reason: "unrepresentable-amount" } };
    }
    throw error;
  }
  const base = runtime.sdk.buildBaseTransaction(ccc.Transaction.default(), {
    orders: state.collectable,
    receipts: state.context.receipts,
    readyWithdrawals: state.context.readyWithdrawals,
  });
  // The mint appends the order output then its master; completion only adds change after.
  const orderOutput = base.outputs.length;
  const tx = await runtime.sdk.request(base, runtime.primaryLock, info, amounts);
  try {
    return {
      tx: await runtime.sdk.completeTransaction(tx, {
        signer: runtime.signer,
        feeRate: state.system.feeRate,
        cells: state.context.cells,
      }),
      action: { order: { outputs: [orderOutput, orderOutput + 1] } },
    };
  } catch (error) {
    return unfundableOrThrow(error);
  }
}

async function buildConversion(
  runtime: Runtime,
  state: StimulusState,
  direction: Draw["direction"],
  amount: bigint,
): Promise<Built> {
  try {
    const result = await runtime.sdk.buildConversionTransaction(
      ccc.Transaction.default(),
      {
        direction,
        amount,
        lock: runtime.primaryLock,
        signer: runtime.signer,
        context: state.context,
      },
    );
    return result.ok
      ? { tx: result.tx, action: { conversion: result.conversion } }
      : { skip: { reason: "conversion-not-buildable", conversion: result.reason } };
  } catch (error) {
    return unfundableOrThrow(error);
  }
}

function unfundableOrThrow(error: unknown): Built {
  if (isIckbError(error) || error instanceof ccc.ErrorTransactionInsufficientCapacity) {
    return { skip: { reason: "unfundable", error } };
  }
  throw error;
}

/** Skips a transaction that would leave plain CKB below the reserve and lower than before. */
function acceptReserve(runtime: Runtime, state: StimulusState, built: Built): Built {
  if ("skip" in built) {
    return built;
  }
  const postTxCkbBalance = postTransactionAccountPlainCkbBalance(
    built.tx,
    state.account.capacityCells,
    runtime.accountLocks,
  );
  if (postTxCkbBalance >= CKB_RESERVE || postTxCkbBalance >= state.plainCkb) {
    return built;
  }
  return {
    skip: {
      reason: "post-tx-ckb-reserve",
      reserve: formatCkb(CKB_RESERVE),
      preTxCkbBalance: formatCkb(state.plainCkb),
      postTxCkbBalance: formatCkb(postTxCkbBalance),
    },
  };
}

async function send(
  runtime: Runtime,
  state: StimulusState,
  { tx, action }: Extract<Built, { tx: ccc.Transaction }>,
  record: Record,
): Promise<void> {
  record({
    action,
    transactionShape: {
      inputs: tx.inputs.length,
      outputs: tx.outputs.length,
      cellDeps: tx.cellDeps.length,
      witnesses: tx.witnesses.length,
    },
    txFee: {
      fee: formatCkb(tx.estimateFee(state.system.feeRate)),
      feeRate: state.system.feeRate,
    },
  });
  let txHash: ccc.Hex;
  try {
    txHash = await signAndSendTransaction(runtime.signer, tx, (hash) => {
      record({ txHash: hash });
    });
  } catch (error) {
    if (!(error instanceof TransactionBroadcastError)) {
      throw error;
    }
    // The hash is known, so the node may have the transaction: wait for it.
    txHash = error.txHash;
  }
  try {
    await waitTransaction(runtime.client, txHash, { timeout: WAIT_TIMEOUT_MS });
  } catch (error) {
    record({
      outcome: error instanceof TransactionWaitError ? "rejected" : "unresolved",
    });
    throw error;
  }
  record({ outcome: "committed" });
}

function balanceLog(state: StimulusState): NonNullable<StimulusLog["balance"]> {
  return {
    CKB: {
      total: formatCkb(state.totalCkb),
      plain: formatCkb(state.plainCkb),
      budget: formatCkb(state.budgets.ckb),
      reserve: formatCkb(CKB_RESERVE),
    },
    ICKB: { total: formatCkb(state.totalIckb), budget: formatCkb(state.budgets.ickb) },
    totalEquivalentCkb: formatCkb(state.totalEquivalentCkb),
    capitalMinimum: formatCkb(state.capitalMinimum),
  };
}
