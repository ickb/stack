import { ccc } from "@ckb-ccc/core";
import { DEFAULT_ORDER_FEE_BASE } from "../../../src/conversion/estimate.ts";
import type { ConversionKind } from "../../../src/conversion/types.ts";
import type { BroadcastDeadline } from "../../../src/dao.ts";
import {
  OrderConversionRepresentabilityError,
  quoteConversion,
} from "../../../src/order/conversion.ts";
import { isFundabilityFailure } from "../../../src/sdk.ts";
import {
  signAndSendTransaction,
  TransactionBroadcastError,
} from "../../../src/send/sign_and_send_transaction.ts";
import {
  TransactionWaitError,
  waitTransaction,
} from "../../../src/send/wait_transaction.ts";
import { transactionShape } from "../shared/format.ts";
import { logExecution } from "../shared/logging.ts";
import { CKB_RESERVE } from "../shared/reserve.ts";
import type { RpcEndpointIdentity } from "../shared/runtime_config.ts";
import { type Draw, drawTurn, type Override } from "./draw.ts";
import {
  MAX_LIVE_ORDERS,
  readStimulusState,
  type Runtime,
  type StimulusState,
} from "./state.ts";

/** Public identity of the stimulus process: who acted, on which chain, through which endpoint. */
export interface StimulusIdentity {
  chain: "testnet";
  address: string;
  primaryLock: { codeHash: ccc.Hex; hashType: ccc.HashType; args: ccc.Hex };
  rpcEndpoints: RpcEndpointIdentity[];
}

/** Every way a turn ends; `committed` is the only one that proves stimulus reached the chain. */
type Outcome = "committed" | "unresolved" | "rejected" | "skipped" | "failed";

type Skip =
  | { reason: "nothing-to-spend" }
  | { reason: "live-order-cap"; live: number }
  | { reason: "unrepresentable-amount" }
  | { reason: "unfundable"; error: unknown }
  | { reason: "conversion-not-buildable"; conversion: string };

/** Order and master output positions, or the SDK's conversion kind, of the sent transaction. */
type Action =
  { order: { outputs: [number, number] } } | { conversionKind: ConversionKind };

/**
 * The one JSON record a turn writes; fields fill in as the turn advances, and the logger
 * adds the `type` and `timestamp` envelope shared with the bot's events.
 */
export interface StimulusLog {
  type?: "stimulus.turn";
  timestamp?: string;
  identity?: StimulusIdentity;
  balance?: {
    CKB: { liquid: string; budget: string; reserve: string };
    ICKB: { budget: string };
  };
  orders?: StimulusState["orders"];
  draw?: Draw;
  outcome?: Outcome;
  /** Why the drawn action was not built. */
  skip?: Skip;
  /** Why the collection sent in its place was not built either. */
  collectSkip?: Skip;
  action?: Action;
  transactionShape?: ReturnType<typeof transactionShape>;
  txFee?: { fee: string; feeRate: ccc.Num };
  txHash?: ccc.Hex;
  error?: unknown;
}

type Built =
  | {
      tx: ccc.Transaction;
      plannedFee: bigint;
      action: Action;
      broadcastBefore?: BroadcastDeadline;
    }
  | { skip: Skip };

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
  const log: StimulusLog = { identity };
  try {
    await stimulate(runtime, override, random, log);
  } catch (error) {
    log.outcome ??= "failed";
    log.error = error;
    process.exitCode = 1;
  }
  logExecution("stimulus.turn", log, startTime);
}

async function stimulate(
  runtime: Runtime,
  override: Override,
  random: () => number,
  log: StimulusLog,
): Promise<void> {
  const state = await readStimulusState(runtime);
  Object.assign(log, { balance: balanceLog(state), orders: state.orders });
  const draw = drawTurn(state.budgets, override, random);
  Object.assign(log, { draw });
  let built: Built;
  if (draw === undefined) {
    built = { skip: { reason: "nothing-to-spend" } };
  } else if (draw.kind === "order" && state.orders.live >= MAX_LIVE_ORDERS) {
    built = { skip: { reason: "live-order-cap", live: state.orders.live } };
  } else {
    built = await build(runtime, state, draw);
  }
  // Whatever stopped the drawn action, collecting what the account has keeps it liquid;
  // the SDK's zero-amount conversion is exactly that transaction.
  if ("skip" in built) {
    Object.assign(log, { skip: built.skip });
    if (hasCollectible(state)) {
      built = await buildConversion(runtime, state, "ckb-to-ickb", 0n);
      if ("skip" in built) {
        Object.assign(log, { collectSkip: built.skip });
      }
    }
  }
  if ("skip" in built) {
    Object.assign(log, { outcome: "skipped" });
    return;
  }
  await send(runtime, state, built, log);
}

async function build(runtime: Runtime, state: StimulusState, draw: Draw): Promise<Built> {
  if (draw.kind === "conversion") {
    return buildConversion(runtime, state, draw.direction, draw.amount);
  }
  const isCkb2Udt = draw.direction === "ckb-to-ickb";
  const amounts = isCkb2Udt
    ? { ckbValue: draw.amount, udtValue: 0n }
    : { ckbValue: 0n, udtValue: draw.amount };
  let info: ReturnType<typeof quoteConversion>["info"];
  try {
    info = quoteConversion(isCkb2Udt, state.system.exchangeRatio, amounts, {
      fee: draw.fee,
      feeBase: DEFAULT_ORDER_FEE_BASE,
    }).info;
  } catch (error) {
    if (error instanceof OrderConversionRepresentabilityError) {
      return { skip: { reason: "unrepresentable-amount" } };
    }
    throw error;
  }
  const base = runtime.sdk.buildBaseTransaction(ccc.Transaction.default(), {
    availableOrders: state.context.availableOrders,
    receipts: state.context.receipts,
    readyWithdrawals: state.context.readyWithdrawals,
  });
  // The mint appends the order output then its master; completion only adds change after.
  const orderOutput = base.outputs.length;
  const tx = runtime.order.mint(base, runtime.primaryLock, info, amounts);
  try {
    return {
      ...(await runtime.sdk.completeTransaction(tx, {
        signer: runtime.signer,
        system: state.system,
        receipts: state.context.receipts,
        cells: state.context.cells,
      })),
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
    const result = await runtime.sdk.buildConversionTransaction({
      direction,
      amount,
      lock: runtime.primaryLock,
      signer: runtime.signer,
      context: state.context,
    });
    return result.ok
      ? {
          tx: result.tx,
          plannedFee: result.plannedFee,
          action: { conversionKind: result.conversionKind },
          ...(result.broadcastBefore === undefined
            ? {}
            : { broadcastBefore: result.broadcastBefore }),
        }
      : { skip: { reason: "conversion-not-buildable", conversion: result.reason } };
  } catch (error) {
    return unfundableOrThrow(error);
  }
}

// The SDK's own test of what completion steps past, so a draw the account cannot fund or
// fit in one transaction is a skip, as it would be for the bot.
function unfundableOrThrow(error: unknown): Built {
  if (isFundabilityFailure(error)) {
    return { skip: { reason: "unfundable", error } };
  }
  throw error;
}

async function send(
  runtime: Runtime,
  state: StimulusState,
  { tx, plannedFee, action, broadcastBefore }: Extract<Built, { tx: ccc.Transaction }>,
  log: StimulusLog,
): Promise<void> {
  Object.assign(log, {
    action,
    transactionShape: transactionShape(tx),
    txFee: { fee: ccc.fixedPointToString(plannedFee), feeRate: state.system.feeRate },
  });
  let txHash: ccc.Hex;
  try {
    txHash = await signAndSendTransaction(
      runtime.signer,
      tx,
      plannedFee,
      undefined,
      broadcastBefore,
    );
  } catch (error) {
    if (!(error instanceof TransactionBroadcastError)) {
      throw error;
    }
    // The hash is known, so the node may have the transaction: wait for it.
    txHash = error.txHash;
  }
  Object.assign(log, { txHash });
  try {
    await waitTransaction(runtime.client, txHash, { timeout: WAIT_TIMEOUT_MS });
  } catch (error) {
    Object.assign(log, {
      outcome: error instanceof TransactionWaitError ? "rejected" : "unresolved",
    });
    throw error;
  }
  Object.assign(log, { outcome: "committed" });
}

function hasCollectible({ context }: StimulusState): boolean {
  return (
    context.availableOrders.length > 0 ||
    context.receipts.length > 0 ||
    context.readyWithdrawals.length > 0
  );
}

function balanceLog(state: StimulusState): NonNullable<StimulusLog["balance"]> {
  return {
    CKB: {
      liquid: ccc.fixedPointToString(state.liquidCkb),
      budget: ccc.fixedPointToString(state.budgets.ckb),
      reserve: ccc.fixedPointToString(CKB_RESERVE),
    },
    ICKB: { budget: ccc.fixedPointToString(state.budgets.ickb) },
  };
}
