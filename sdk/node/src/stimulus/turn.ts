import { ccc } from "@ckb-ccc/core";
import { CKB_RESERVE } from "../../../src/constants.ts";
import { IckbError } from "../../../src/conversion/error.ts";
import { DEFAULT_ORDER_FEE_BASE } from "../../../src/conversion/estimate.ts";
import type { ConversionMetadata } from "../../../src/conversion/types.ts";
import {
  OrderConversionRepresentabilityError,
  quoteConversion,
} from "../../../src/order/conversion.ts";
import {
  signAndSendTransaction,
  TransactionBroadcastError,
} from "../../../src/send/sign_and_send_transaction.ts";
import {
  TransactionWaitError,
  waitTransaction,
} from "../../../src/send/wait_transaction.ts";
import type { ChainPreflightEvidence } from "../shared/chain.ts";
import { formatCkb, transactionShape } from "../shared/format.ts";
import { logExecution } from "../shared/logging.ts";
import type { PublicRpcEndpointIdentity } from "../shared/runtime_config.ts";
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
  rpcEndpoint: PublicRpcEndpointIdentity;
  preflight: Omit<ChainPreflightEvidence, "chain">;
}

/** Every way a turn ends; `committed` is the only one that proves stimulus reached the chain. */
export type Outcome = "committed" | "unresolved" | "rejected" | "skipped" | "failed";

export type Skip =
  | { reason: "nothing-to-spend" }
  | { reason: "live-order-cap"; live: number }
  | { reason: "unrepresentable-amount" }
  | { reason: "unfundable"; error: unknown }
  | { reason: "conversion-not-buildable"; conversion: string };

/** Order and master output positions, or the SDK's conversion kind, of the sent transaction. */
export type Action =
  { order: { outputs: [number, number] } } | { conversion: ConversionMetadata };

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
  draw?: Draw | { kind: "collect-only" };
  outcome?: Outcome;
  skip?: Skip;
  action?: Action;
  transactionShape?: ReturnType<typeof transactionShape>;
  txFee?: { fee: string; feeRate: ccc.Num };
  txHash?: ccc.Hex;
  error?: unknown;
}

type Built =
  { tx: ccc.Transaction; action: Action; broadcastBefore?: ccc.Epoch } | { skip: Skip };

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
  if ("skip" in built && hasCollectible(state)) {
    Object.assign(log, { skip: built.skip, draw: { kind: "collect-only" } });
    built = await buildConversion(runtime, state, "ckb-to-ickb", 0n);
  }
  if ("skip" in built) {
    Object.assign(log, { outcome: "skipped", skip: built.skip });
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
    availableOrders: state.collectable,
    receipts: state.context.receipts,
    readyWithdrawals: state.context.readyWithdrawals,
  });
  // The mint appends the order output then its master; completion only adds change after.
  const orderOutput = base.outputs.length;
  const tx = runtime.order.mint(base, runtime.primaryLock, info, amounts);
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
      ? {
          tx: result.tx,
          action: { conversion: result.conversion },
          ...(result.broadcastBefore === undefined
            ? {}
            : { broadcastBefore: result.broadcastBefore }),
        }
      : { skip: { reason: "conversion-not-buildable", conversion: result.reason } };
  } catch (error) {
    return unfundableOrThrow(error);
  }
}

function unfundableOrThrow(error: unknown): Built {
  if (
    error instanceof IckbError ||
    error instanceof ccc.ErrorTransactionInsufficientCapacity
  ) {
    return { skip: { reason: "unfundable", error } };
  }
  throw error;
}

async function send(
  runtime: Runtime,
  state: StimulusState,
  { tx, action, broadcastBefore }: Extract<Built, { tx: ccc.Transaction }>,
  log: StimulusLog,
): Promise<void> {
  Object.assign(log, {
    action,
    transactionShape: transactionShape(tx),
    txFee: {
      fee: formatCkb(tx.estimateFee(state.system.feeRate)),
      feeRate: state.system.feeRate,
    },
  });
  let txHash: ccc.Hex;
  try {
    txHash = await signAndSendTransaction(
      runtime.signer,
      tx,
      (hash) => {
        Object.assign(log, { txHash: hash });
      },
      broadcastBefore,
    );
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
      liquid: formatCkb(state.liquidCkb),
      budget: formatCkb(state.budgets.ckb),
      reserve: formatCkb(CKB_RESERVE),
    },
    ICKB: { budget: formatCkb(state.budgets.ickb) },
  };
}
