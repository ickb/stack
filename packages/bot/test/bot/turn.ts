import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP } from "@ickb/core";
import { OrderManager } from "@ickb/order";
import { TransactionBroadcastError } from "@ickb/sdk";
import {
  chainState,
  FakeClient,
  headerLike,
  type ChainState,
  type FakeClientOverrides,
} from "@ickb/testkit";
import { afterEach, expect, it, vi } from "vitest";
import {
  BOT_TRANSACTION_WAIT_INTERVAL_MS,
  BOT_TRANSACTION_WAIT_TIMEOUT_MS,
  runBotTurn,
  type BotTurnContext,
} from "../../src/bot/turn.ts";
import { BotEventEmitter } from "../../src/observability/events.ts";
import type { Runtime } from "../../src/runtime/types.ts";
import {
  botRuntime,
  completeSearchResult,
  hash,
  l1AccountState,
  matchDiagnostics,
  TARGET_ICKB_BALANCE,
  testWithdrawal,
  type L1AccountState,
} from "./fixtures/bot.ts";

const BOT_TURN_STARTED = "bot.turn.started";
const BOT_STATE_READ = "bot.state.read";
const BOT_TURN_FAILED = "bot.turn.failed";
const BOT_TRANSACTION_SENT = "bot.transaction.sent";
const BOT_TRANSACTION_CONFIRMATION = "bot.transaction.confirmation";
const BOT_TRANSACTION_COMMITTED = "bot.transaction.committed";
const BOT_TRANSACTION_FAILED = "bot.transaction.failed";
const FETCH_FAILED = "fetch failed";
const RBF_REJECTED_REASON = JSON.stringify({
  type: "RBFRejected",
  description: `RBF rejected: replaced by tx Byte32(0x${"22".repeat(32)})`,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  process.exitCode = undefined;
});

it("stops with event-only low-capital evidence", async () => {
  const harness = turnHarness({ account: l1AccountState() });

  await runBotTurn(harness.context);

  expect(process.exitCode).toBe(2);
  expect(eventTypes(harness.events)).toEqual([
    BOT_TURN_STARTED,
    BOT_STATE_READ,
    "bot.decision.skipped",
  ]);
  expect(harness.events.at(-1)).toMatchObject({
    reason: "capital_below_minimum",
    deficit: String((21n * ICKB_DEPOSIT_CAP) / 20n),
  });
  expect(harness.sendTransaction).not.toHaveBeenCalled();
});

it("records skipped terminal iterations without legacy execution logs", async () => {
  noMatch();
  const harness = turnHarness();

  await runBotTurn(harness.context);

  expect(eventTypes(harness.events)).toEqual([
    BOT_TURN_STARTED,
    BOT_STATE_READ,
    "bot.match.evaluated",
    "bot.rebalance.evaluated",
    "bot.decision.skipped",
  ]);
  expect(harness.sendTransaction).not.toHaveBeenCalled();
});

it("sends explicitly and waits with the finite production policy", async () => {
  // A CKB-rich, iCKB-poor account under a useful iCKB floor plans a direct deposit,
  // the one rebalance kind that carries no ring diagnostics.
  noMatch(matchDiagnostics({ ckbValue: ccc.fixedPointFrom(2000), udtValue: 99n }));
  vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(7n);
  const harness = turnHarness({
    account: fundedAccount({ ckb: ccc.fixedPointFrom(200_000), ickb: 0n }),
  });

  await runBotTurn(harness.context);

  const recordTxHash = harness.sendTransaction.mock.calls[0]?.[1];
  expect(typeof recordTxHash).toBe("function");
  expect(eventTypes(harness.events)).toEqual([
    BOT_TURN_STARTED,
    BOT_STATE_READ,
    "bot.match.evaluated",
    "bot.rebalance.evaluated",
    "bot.transaction.built",
    BOT_TRANSACTION_SENT,
    BOT_TRANSACTION_CONFIRMATION,
    BOT_TRANSACTION_COMMITTED,
  ]);
  expect(harness.events[4]).toMatchObject({
    decision: { rebalance: { kind: "deposit", reason: "low_ickb_balance" } },
  });
  expect(harness.events[5]).toMatchObject({
    txHash: harness.sentHash(),
    transaction: { fee: "7", feeRate: "1" },
  });
  expect(harness.events[6]).toMatchObject({
    txHash: harness.sentHash(),
    status: "committed",
    timeoutMs: BOT_TRANSACTION_WAIT_TIMEOUT_MS,
    intervalMs: BOT_TRANSACTION_WAIT_INTERVAL_MS,
  });
});

it("reports broadcast failures with send-phase evidence", async () => {
  noMatch();
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    sendTransaction: async () => {
      await Promise.resolve();
      throw new Error("transaction broadcast failed");
    },
  });

  await runBotTurn(harness.context);

  expect(process.exitCode).toBe(1);
  expect(
    harness.events.find((event) => event.type === BOT_TRANSACTION_FAILED),
  ).toMatchObject({
    phase: "broadcast",
    outcome: "send_failed",
    retryable: false,
    terminal: true,
    error: { message: "transaction broadcast failed" },
  });
});

it("confirms the recorded hash after an ambiguous send without rebuilding", async () => {
  noMatch();
  const chain = chainState();
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    chain,
    sendTransaction: async (txLike, recordTxHash) => {
      await Promise.resolve();
      const txHash = commitTransaction(chain, txLike);
      recordTxHash?.(txHash);
      throw new TransactionBroadcastError(txHash, { cause: new TypeError(FETCH_FAILED) });
    },
  });

  await runBotTurn(harness.context);

  expect(harness.sendTransaction).toHaveBeenCalledTimes(1);
  expect(harness.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: BOT_TRANSACTION_SENT,
        txHash: harness.sentHash(),
        outcome: "broadcast_ambiguous",
      }),
      expect.objectContaining({
        type: BOT_TRANSACTION_COMMITTED,
        txHash: harness.sentHash(),
      }),
    ]),
  );
});

it("falls back to the broadcast error hash when no hash was recorded", async () => {
  noMatch();
  const chain = chainState();
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    chain,
    sendTransaction: async (txLike) => {
      await Promise.resolve();
      throw new TransactionBroadcastError(commitTransaction(chain, txLike), {
        cause: new TypeError(FETCH_FAILED),
      });
    },
  });

  await runBotTurn(harness.context);

  expect(harness.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: BOT_TRANSACTION_SENT,
        txHash: harness.sentHash(),
        outcome: "broadcast_ambiguous",
      }),
      expect.objectContaining({
        type: BOT_TRANSACTION_COMMITTED,
        txHash: harness.sentHash(),
      }),
    ]),
  );
});

it("normalizes confirmation error fields from public errors", async () => {
  noMatch();
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    client: {
      getTransactionNoCache: async () => {
        await Promise.resolve();
        throw Object.assign(new Error("transaction confirmation failed"), {
          reason: "node rejected transaction",
          status: 503,
        });
      },
    },
  });

  await runBotTurn(harness.context);

  // The outcome is unknown; the next turn rebuilds from committed state.
  expect(process.exitCode).toBe(1);
  expect(
    harness.events.find((event) => event.type === BOT_TRANSACTION_CONFIRMATION),
  ).toMatchObject({
    txHash: harness.sentHash(),
    outcome: "confirmation_failed",
    status: "unresolved",
    reason: "node rejected transaction",
    isTimeout: false,
    retryable: false,
    terminal: true,
  });
});

// Only an RBF replacement proves the sent transaction can never confirm, so only it is
// classified retryable; either way the next turn rebuilds (exit 1).
it.each([
  { reason: RBF_REJECTED_REASON, retryable: true },
  { reason: "Resolve failed Dead(OutPoint(...))", retryable: false },
])("exits 1 and classifies the rejection: $reason", async ({ reason, retryable }) => {
  noMatch();
  const chain = chainState();
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    chain,
    sendTransaction: async (txLike) => {
      await Promise.resolve();
      const transaction = ccc.Transaction.from(txLike);
      chain.tx({ transaction, status: "rejected", reason });
      return transaction.hash();
    },
  });

  await runBotTurn(harness.context);

  expect(harness.sendTransaction).toHaveBeenCalledTimes(1);
  expect(process.exitCode).toBe(1);
  expect(harness.events.at(-1)).toMatchObject({ type: BOT_TURN_FAILED, retryable });
});

it("tolerates confirmation fields disappearing during inspection", async () => {
  noMatch();
  let statusChecks = 0;
  const error = new Proxy(
    Object.assign(new Error("transaction confirmation failed"), {
      status: "rejected",
    }),
    {
      has: (target, property): boolean => {
        if (property === "status") {
          statusChecks += 1;
          return statusChecks === 1;
        }
        return Reflect.has(target, property);
      },
    },
  );
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    client: {
      getTransactionNoCache: async () => {
        await Promise.resolve();
        throw error;
      },
    },
  });

  await runBotTurn(harness.context);

  expect(
    harness.events.find((event) => event.type === BOT_TRANSACTION_CONFIRMATION),
  ).toMatchObject({ status: "unresolved" });
});

it("ends the attempt after one confirmation window without resending or rebuilding", async () => {
  noMatch();
  vi.useFakeTimers();
  const chain = chainState();
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    chain,
    sendTransaction: async (txLike) => {
      await Promise.resolve();
      const transaction = ccc.Transaction.from(txLike);
      chain.tx({ transaction, status: "pending" });
      return transaction.hash();
    },
  });

  const turn = runBotTurn(harness.context);
  await vi.advanceTimersByTimeAsync(BOT_TRANSACTION_WAIT_TIMEOUT_MS);
  await turn;

  expect(process.exitCode).toBe(1);
  expect(harness.sendTransaction).toHaveBeenCalledTimes(1);
  const timeoutFailure = {
    txHash: harness.sentHash(),
    outcome: "timeout",
    isTimeout: true,
    retryable: false,
    terminal: true,
  };
  expect(
    harness.events.find((event) => event.type === BOT_TRANSACTION_CONFIRMATION),
  ).toMatchObject(timeoutFailure);
  expect(
    harness.events.find((event) => event.type === BOT_TRANSACTION_FAILED),
  ).toMatchObject(timeoutFailure);
  expect(
    harness.events.filter((event) => event.type === BOT_TRANSACTION_COMMITTED),
  ).toHaveLength(0);
});

it("exits 1 with retryable metadata so the next turn can retry", async () => {
  const harness = turnHarness({
    getL1AccountState: async () => {
      await Promise.resolve();
      throw new TypeError(FETCH_FAILED);
    },
  });

  await runBotTurn(harness.context);

  expect(process.exitCode).toBe(1);
  expect(harness.sendTransaction).not.toHaveBeenCalled();
  expect(harness.events.at(-1)).toMatchObject({
    type: BOT_TURN_FAILED,
    retryable: true,
    terminal: false,
    error: { name: "TypeError", message: FETCH_FAILED },
  });
  expect(harness.events.at(-1)?.["error"]).not.toHaveProperty("stack");
});

it("stops non-retryable failures with structured event evidence", async () => {
  vi.spyOn(OrderManager, "bestMatch").mockImplementation(() => {
    throw new Error("deterministic build failure");
  });
  const harness = turnHarness();

  await runBotTurn(harness.context);

  expect(process.exitCode).toBe(1);
  expect(harness.events.at(-1)).toMatchObject({
    type: BOT_TURN_FAILED,
    retryable: false,
    terminal: true,
    error: { message: "deterministic build failure" },
  });
});

function turnHarness(
  options: {
    account?: L1AccountState;
    chain?: ChainState;
    client?: FakeClientOverrides;
    getL1AccountState?: Runtime["sdk"]["getL1AccountState"];
    sendTransaction?: Runtime["sendTransaction"];
  } = {},
): {
  context: BotTurnContext;
  events: Array<Record<string, unknown> & { type: string }>;
  sendTransaction: ReturnType<typeof vi.fn<Runtime["sendTransaction"]>>;
  sentHash: () => ccc.Hex;
} {
  const chain = options.chain ?? chainState();
  const account = options.account ?? fundedAccount();
  const events: Array<Record<string, unknown> & { type: string }> = [];
  // The default fake node accepts and commits whatever the bot sends.
  const sendTransaction = vi.fn<Runtime["sendTransaction"]>(
    options.sendTransaction ??
      (async (txLike): Promise<ccc.Hex> => {
        await Promise.resolve();
        return commitTransaction(chain, txLike);
      }),
  );
  const runtime = botRuntime({
    client: new FakeClient(chain, options.client),
    sdk: {
      getL1AccountState:
        options.getL1AccountState ??
        (async (): Promise<L1AccountState> => {
          await Promise.resolve();
          return account;
        }),
    },
    sendTransaction,
  });
  return {
    context: {
      events: new BotEventEmitter({
        chain: "testnet",
        runId: "run-1",
        write: (event): void => {
          events.push(event);
        },
      }),
      runtime,
    },
    events,
    sendTransaction,
    sentHash: (): ccc.Hex => {
      const txLike = sendTransaction.mock.calls[0]?.[0];
      if (txLike === undefined) {
        throw new Error("Nothing was sent");
      }
      return ccc.Transaction.from(txLike).hash();
    },
  };
}

/** By default enough CKB and target iCKB that no policy action is due. */
function fundedAccount(
  options: { ckb?: bigint; ickb?: bigint; withdrawal?: boolean } = {},
): L1AccountState {
  const ickb = options.ickb ?? TARGET_ICKB_BALANCE;
  return l1AccountState({
    capacityCells: [
      ccc.Cell.from({
        outPoint: { txHash: hash("aa"), index: 0n },
        cellOutput: {
          capacity: options.ckb ?? ccc.fixedPointFrom(2000),
          lock: hashScript("11"),
        },
        outputData: "0x",
      }),
    ],
    nativeUdtCells: [
      ccc.Cell.from({
        outPoint: { txHash: hash("ab"), index: 0n },
        cellOutput: { capacity: 0n, lock: hashScript("11") },
        outputData: ccc.numLeToBytes(ickb, 16),
      }),
    ],
    nativeUdtBalance: ickb,
    withdrawalGroups: options.withdrawal === true ? [testWithdrawal("62")] : [],
  });
}

function noMatch(diagnostics?: ReturnType<typeof matchDiagnostics>): void {
  vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
    completeSearchResult({ ckbDelta: 0n, udtDelta: 0n, partials: [], diagnostics }),
  );
}

function commitTransaction(chain: ChainState, txLike: ccc.TransactionLike): ccc.Hex {
  const transaction = ccc.Transaction.from(txLike);
  chain.committedTx(transaction, headerLike({ number: 1n }));
  return transaction.hash();
}

function hashScript(byte: string): ccc.Script {
  return ccc.Script.from({ codeHash: hash(byte), hashType: "type", args: "0x" });
}

function eventTypes(events: Array<{ type: string }>): string[] {
  return events.map((event) => event.type);
}
