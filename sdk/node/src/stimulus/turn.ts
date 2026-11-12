import { ccc } from "@ckb-ccc/core";
import { buildBaseTransaction, buildConversionTransaction } from "../../../src/build.ts";
import { completeTransaction, type CompletionFailure } from "../../../src/complete.ts";
import type { ConversionKind } from "../../../src/conversion/types.ts";
import type { BroadcastDeadline } from "../../../src/dao.ts";
import { quoteOrder } from "../../../src/order/conversion.ts";
import { mint } from "../../../src/order/order.ts";
import { commitTransaction } from "../../../src/send/commit_transaction.ts";
import { COMMIT_BUDGET_MS } from "../shared/chain.ts";
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
  | { reason: "unfundable"; failure: CompletionFailure }
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
      broadcastBefore: BroadcastDeadline | undefined;
    }
  | { skip: Skip };

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
    if (!state.hasCollectable) {
      Object.assign(log, { outcome: "skipped" });
      return;
    }
    const collection = await buildConversion(runtime, state, "ckb-to-ickb", 0n);
    if ("skip" in collection) {
      Object.assign(log, { collectSkip: collection.skip, outcome: "skipped" });
      return;
    }
    built = collection;
  }
  await send(runtime, state, built, log);
}

async function build(runtime: Runtime, state: StimulusState, draw: Draw): Promise<Built> {
  if (draw.kind === "conversion") {
    return buildConversion(runtime, state, draw.direction, draw.amount);
  }
  const amounts =
    draw.direction === "ckb-to-ickb"
      ? { ckbValue: draw.amount, udtValue: 0n }
      : { ckbValue: 0n, udtValue: draw.amount };
  const quote = quoteOrder(state.exchangeRatio, draw.direction, draw.amount, {
    fee: draw.fee,
  });
  if (!quote.ok) {
    return { skip: { reason: "unrepresentable-amount" } };
  }
  const { info } = quote;
  const base = buildBaseTransaction(ccc.Transaction.default(), state);
  // The mint appends the order output then its master; completion only adds change after.
  const orderOutput = base.outputs.length;
  const tx = mint(base, state.changeLock, info, amounts);
  const done = await completeTransaction(tx, {
    signer: runtime.signer,
    state,
  });
  // A draw the account cannot fund or fit in one transaction is a skip, as it is for the bot.
  if (!done.ok) {
    return { skip: { reason: "unfundable", failure: done } };
  }
  return {
    tx: done.tx,
    plannedFee: done.plannedFee,
    action: { order: { outputs: [orderOutput, orderOutput + 1] } },
    // An order requests no withdrawal.
    broadcastBefore: undefined,
  };
}

async function buildConversion(
  runtime: Runtime,
  state: StimulusState,
  direction: Draw["direction"],
  amount: bigint,
): Promise<Built> {
  const result = await buildConversionTransaction(
    runtime.signer,
    state,
    direction,
    amount,
  );
  return result.ok
    ? {
        tx: result.tx,
        plannedFee: result.plannedFee,
        action: { conversionKind: result.conversionKind },
        broadcastBefore: result.broadcastBefore,
      }
    : { skip: { reason: "conversion-not-buildable", conversion: result.reason } };
}

async function send(
  runtime: Runtime,
  state: StimulusState,
  built: Extract<Built, { tx: ccc.Transaction }>,
  log: StimulusLog,
): Promise<void> {
  const { tx, plannedFee, action } = built;
  Object.assign(log, {
    action,
    transactionShape: transactionShape(tx),
    txFee: { fee: ccc.fixedPointToString(plannedFee), feeRate: state.feeRate },
  });
  // Replaced at `sent`, which comes before any pending step.
  let sentAt = Date.now();
  for await (const step of commitTransaction(runtime.signer, built)) {
    const { txHash } = step;
    const outcome = step.ok ? step.status : step.reason;
    if (outcome === "sent") {
      // Unresolved until a later step says otherwise.
      Object.assign(log, { txHash, outcome: "unresolved" });
      sentAt = Date.now();
      continue;
    }
    if (outcome === "rejected") {
      Object.assign(log, { outcome });
    }
    // Nothing sent, a rejection or a failed read fails the turn; the next one rebuilds.
    if (!step.ok || step.cause !== undefined) {
      throw new Error(`Transaction ${txHash} ${outcome}`, { cause: step });
    }
    if (outcome === "committed") {
      Object.assign(log, { outcome });
      return;
    }
    // Still pending with no failure: left unresolved for the next build.
    if (Date.now() - sentAt >= COMMIT_BUDGET_MS) {
      return;
    }
  }
}

function balanceLog(state: StimulusState): NonNullable<StimulusLog["balance"]> {
  return {
    CKB: {
      liquid: ccc.fixedPointToString(state.ckbNative),
      budget: ccc.fixedPointToString(state.budgets.ckb),
      reserve: ccc.fixedPointToString(CKB_RESERVE),
    },
    ICKB: { budget: ccc.fixedPointToString(state.budgets.ickb) },
  };
}
