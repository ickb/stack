import { ccc } from "@ckb-ccc/core";
import { OrderManager } from "../../../src/order/index.ts";
import { TransactionBroadcastError } from "../../../src/send/sign_and_send_transaction.ts";

import {
  chainState,
  FakeClient,
  headerLike,
  type ChainState,
  type FakeClientOverrides,
} from "@ickb/testkit";
import { afterEach, expect, it, vi } from "vitest";
import { BotEventEmitter } from "../../src/bot/events.ts";
import type { Runtime } from "../../src/bot/runtime/types.ts";
import {
  BOT_TRANSACTION_WAIT_INTERVAL_MS,
  BOT_TRANSACTION_WAIT_TIMEOUT_MS,
  runBotTurn,
  type BotTurnContext,
} from "../../src/bot/turn.ts";
import type { JsonLogRecord } from "../../src/shared/index.ts";
import {
  BAND_ICKB_BALANCE,
  botRuntime,
  hash,
  l1AccountState,
  testWithdrawal,
  type L1AccountState,
} from "./fixtures/bot.ts";

const BOT_STATE_READ = "bot.state.read";
const BOT_TRANSACTION_BUILT = "bot.transaction.built";
const BOT_TURN_FAILED = "bot.turn.failed";
const BOT_TRANSACTION_SENT = "bot.transaction.sent";
const BOT_TRANSACTION_COMMITTED = "bot.transaction.committed";
const FETCH_FAILED = "fetch failed";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  process.exitCode = undefined;
});

it("records a skipped decision with its evidence and no ring segment list", async () => {
  const harness = turnHarness();

  await runBotTurn(harness.context);

  expect(eventTypes(harness.events)).toEqual([BOT_STATE_READ, "bot.decision.skipped"]);
  expect(harness.events[1]).toMatchObject({
    reason: "no_actions",
    decision: { match: { reason: "no_market_orders" }, core: { kind: "none" } },
  });
  expect(JSON.stringify(harness.events[1])).not.toContain("segments");
  expect(harness.sendTransaction).not.toHaveBeenCalled();
});

it("keeps turning below the recommended funding instead of holding", async () => {
  const harness = turnHarness({ account: l1AccountState() });

  await runBotTurn(harness.context);

  expect(process.exitCode).toBeUndefined();
  expect(eventTypes(harness.events)).toEqual([BOT_STATE_READ, "bot.decision.skipped"]);
  expect(harness.sendTransaction).not.toHaveBeenCalled();
});

it("sends explicitly and waits with the finite production policy", async () => {
  // A CKB-rich, iCKB-poor account refills its iCKB with one deposit.
  vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(7n);
  const harness = turnHarness({
    account: fundedAccount({ ckb: ccc.fixedPointFrom(200_000), ickb: 0n }),
  });

  await runBotTurn(harness.context);

  const recordTxHash = harness.sendTransaction.mock.calls[0]?.[1];
  expect(typeof recordTxHash).toBe("function");
  expect(eventTypes(harness.events)).toEqual([
    BOT_STATE_READ,
    BOT_TRANSACTION_BUILT,
    BOT_TRANSACTION_SENT,
    BOT_TRANSACTION_COMMITTED,
  ]);
  expect(harness.events[1]).toMatchObject({
    decision: { rebalance: { deposit: "low_ickb" }, core: { kind: "deposit" } },
  });
  expect(harness.events[2]).toMatchObject({
    txHash: harness.sentHash(),
    outcome: "broadcasted",
    fee: "7",
    feeRate: "1",
  });
  expect(harness.events[2]).toHaveProperty("transactionShape.witnesses");
  expect(harness.events[3]).toMatchObject({
    txHash: harness.sentHash(),
    status: "committed",
    timeoutMs: BOT_TRANSACTION_WAIT_TIMEOUT_MS,
    intervalMs: BOT_TRANSACTION_WAIT_INTERVAL_MS,
  });
});

it("ends the turn with the broadcast error when the send fails without a hash", async () => {
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    sendTransaction: async () => {
      await Promise.resolve();
      throw new Error("transaction broadcast failed");
    },
  });

  await runBotTurn(harness.context);

  expect(process.exitCode).toBe(1);
  expect(eventTypes(harness.events)).toEqual([
    BOT_STATE_READ,
    BOT_TRANSACTION_BUILT,
    BOT_TURN_FAILED,
  ]);
  expect(harness.events.at(-1)).toMatchObject({
    error: { name: "Error", message: "transaction broadcast failed" },
  });
});

it("confirms the recorded hash after an ambiguous send without rebuilding", async () => {
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
  expect(eventTypes(harness.events)).toEqual([
    BOT_STATE_READ,
    BOT_TRANSACTION_BUILT,
    BOT_TRANSACTION_SENT,
    BOT_TRANSACTION_COMMITTED,
  ]);
  expect(harness.events[2]).toMatchObject({
    txHash: harness.sentHash(),
    outcome: "broadcast_ambiguous",
    error: { name: "TransactionBroadcastError", cause: { message: FETCH_FAILED } },
  });
  expect(harness.events[3]).toMatchObject({ txHash: harness.sentHash() });
});

it("falls back to the broadcast error hash when no hash was recorded", async () => {
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

it("ends the attempt after one confirmation window without resending or rebuilding", async () => {
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
  expect(eventTypes(harness.events)).toEqual([
    BOT_STATE_READ,
    BOT_TRANSACTION_BUILT,
    BOT_TRANSACTION_SENT,
    BOT_TURN_FAILED,
  ]);
  expect(harness.events.at(-1)).toMatchObject({
    error: {
      message: `Client request error Wait transaction timeout ${String(BOT_TRANSACTION_WAIT_TIMEOUT_MS)}ms`,
    },
  });
});

it("ends the turn with the SDK wait error when the node rejects the transaction", async () => {
  const chain = chainState();
  const reason = "Resolve failed Dead(OutPoint(...))";
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

  expect(process.exitCode).toBe(1);
  expect(harness.events.at(-1)).toMatchObject({
    type: BOT_TURN_FAILED,
    error: {
      name: "TransactionWaitError",
      txHash: harness.sentHash(),
      status: "rejected",
      reason,
    },
  });
});

it("exits 1 with the error, its stack, and no private material when the read fails", async () => {
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
    error: { name: "TypeError", message: FETCH_FAILED },
  });
  expect(JSON.stringify(harness.events.at(-1))).toContain(
    '"stack":"TypeError: fetch failed',
  );
});

it("exits 1 with structured event evidence for a build failure", async () => {
  vi.spyOn(OrderManager.prototype, "addMatch").mockImplementation(() => {
    throw new Error("deterministic build failure");
  });
  const harness = turnHarness();

  await runBotTurn(harness.context);

  expect(process.exitCode).toBe(1);
  expect(harness.events.at(-1)).toMatchObject({
    type: BOT_TURN_FAILED,
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
  events: JsonLogRecord[];
  sendTransaction: ReturnType<typeof vi.fn<Runtime["sendTransaction"]>>;
  sentHash: () => ccc.Hex;
} {
  const chain = options.chain ?? chainState();
  const account = options.account ?? fundedAccount();
  const events: JsonLogRecord[] = [];
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

/** By default enough CKB and in-band iCKB that no policy action is due. */
function fundedAccount(
  options: { ckb?: bigint; ickb?: bigint; withdrawal?: boolean } = {},
): L1AccountState {
  const ickb = options.ickb ?? BAND_ICKB_BALANCE;
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

function commitTransaction(chain: ChainState, txLike: ccc.TransactionLike): ccc.Hex {
  const transaction = ccc.Transaction.from(txLike);
  chain.committedTx(transaction, headerLike({ number: 1n }));
  return transaction.hash();
}

function hashScript(byte: string): ccc.Script {
  return ccc.Script.from({ codeHash: hash(byte), hashType: "type", args: "0x" });
}

function eventTypes(events: JsonLogRecord[]): unknown[] {
  return events.map((event) => event["type"]);
}
