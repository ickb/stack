import { ccc } from "@ckb-ccc/core";
import { OrderManager } from "../../../src/order/order.ts";
import { TransactionBroadcastError } from "../../../src/send/sign_and_send_transaction.ts";

import {
  committedTransactionResponse,
  headerLike,
  script,
  StubClient,
  type StubClientHandlers,
} from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IckbDepositCell } from "../../../src/logic.ts";
import { MasterCell, OrderGroup } from "../../../src/order/cells.ts";
import { Ratio } from "../../../src/order/ratio.ts";
import type { IckbSdk } from "../../../src/sdk.ts";
import { BotEventEmitter } from "../../src/bot/events.ts";
import { POOL_MAX_LOCK_UP, POOL_MIN_LOCK_UP } from "../../src/bot/policy.ts";
import {
  BOT_TRANSACTION_WAIT_INTERVAL_MS,
  BOT_TRANSACTION_WAIT_TIMEOUT_MS,
  readBotState,
  runBotTurn,
  type BotTurnContext,
} from "../../src/bot/turn.ts";
import type { Runtime } from "../../src/bot/types.ts";
import {
  BAND_ICKB_BALANCE,
  botRuntime,
  hash,
  l1AccountState,
  NO_DEPOSITS,
  readyDeposit,
  testMatch,
  testWithdrawal,
  type L1AccountState,
} from "./fixtures/bot.ts";

const BOT_STATE_READ = "bot.state.read";
const BOT_TRANSACTION_BUILT = "bot.transaction.built";
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

  await expect(runBotTurn(harness.context)).rejects.toMatchObject({
    name: "Error",
    message: "transaction broadcast failed",
  });
  expect(eventTypes(harness.events)).toEqual([BOT_STATE_READ, BOT_TRANSACTION_BUILT]);
});

it("confirms the recorded hash after an ambiguous send without rebuilding", async () => {
  const responses = new Map<ccc.Hex, ccc.ClientTransactionResponse>();
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    responses,
    sendTransaction: async (txLike, recordTxHash) => {
      await Promise.resolve();
      const txHash = commitTransaction(responses, txLike);
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
  const responses = new Map<ccc.Hex, ccc.ClientTransactionResponse>();
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    responses,
    sendTransaction: async (txLike) => {
      await Promise.resolve();
      throw new TransactionBroadcastError(commitTransaction(responses, txLike), {
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
  const responses = new Map<ccc.Hex, ccc.ClientTransactionResponse>();
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    responses,
    sendTransaction: async (txLike) => {
      await Promise.resolve();
      const transaction = ccc.Transaction.from(txLike);
      responses.set(
        transaction.hash(),
        ccc.ClientTransactionResponse.from({ transaction, status: "pending" }),
      );
      return transaction.hash();
    },
  });

  const turn = (async (): Promise<unknown> => {
    try {
      await runBotTurn(harness.context);
      return undefined;
    } catch (error) {
      return error;
    }
  })();
  await vi.advanceTimersByTimeAsync(BOT_TRANSACTION_WAIT_TIMEOUT_MS);
  const failure = await turn;

  expect(harness.sendTransaction).toHaveBeenCalledTimes(1);
  expect(eventTypes(harness.events)).toEqual([
    BOT_STATE_READ,
    BOT_TRANSACTION_BUILT,
    BOT_TRANSACTION_SENT,
  ]);
  expect(failure).toMatchObject({
    message: `Client request error Wait transaction timeout ${String(BOT_TRANSACTION_WAIT_TIMEOUT_MS)}ms`,
  });
});

it("ends the turn with the SDK wait error when the node rejects the transaction", async () => {
  const responses = new Map<ccc.Hex, ccc.ClientTransactionResponse>();
  const reason = "Resolve failed Dead(OutPoint(...))";
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    responses,
    sendTransaction: async (txLike) => {
      await Promise.resolve();
      const transaction = ccc.Transaction.from(txLike);
      responses.set(
        transaction.hash(),
        ccc.ClientTransactionResponse.from({ transaction, status: "rejected", reason }),
      );
      return transaction.hash();
    },
  });

  const failure = await (async (): Promise<unknown> => {
    try {
      await runBotTurn(harness.context);
      return undefined;
    } catch (error) {
      return error;
    }
  })();

  expect(failure).toMatchObject({
    name: "TransactionWaitError",
    txHash: harness.sentHash(),
    status: "rejected",
    reason,
  });
  expect(eventTypes(harness.events).at(-1)).toBe(BOT_TRANSACTION_SENT);
});

it("propagates the read failure with nothing sent", async () => {
  const harness = turnHarness({
    getL1AccountState: async () => {
      await Promise.resolve();
      throw new TypeError(FETCH_FAILED);
    },
  });

  await expect(runBotTurn(harness.context)).rejects.toMatchObject({
    name: "TypeError",
    message: FETCH_FAILED,
  });
  expect(harness.sendTransaction).not.toHaveBeenCalled();
  expect(harness.events).toEqual([]);
});

it("propagates a build failure after the state event", async () => {
  vi.spyOn(OrderManager.prototype, "addMatch").mockImplementation(() => {
    throw new Error("deterministic build failure");
  });
  const harness = turnHarness();

  await expect(runBotTurn(harness.context)).rejects.toThrow(
    "deterministic build failure",
  );
  expect(eventTypes(harness.events)).toEqual([BOT_STATE_READ]);
});

function turnHarness(
  options: {
    account?: L1AccountState;
    responses?: Map<ccc.Hex, ccc.ClientTransactionResponse>;
    client?: StubClientHandlers;
    getL1AccountState?: Runtime["sdk"]["getL1AccountState"];
    sendTransaction?: Runtime["sendTransaction"];
  } = {},
): {
  context: BotTurnContext;
  events: object[];
  sendTransaction: ReturnType<typeof vi.fn<Runtime["sendTransaction"]>>;
  sentHash: () => ccc.Hex;
} {
  const responses =
    options.responses ?? new Map<ccc.Hex, ccc.ClientTransactionResponse>();
  const account = options.account ?? fundedAccount();
  const events: object[] = [];
  // The default node accepts and commits whatever the bot sends; the confirmation wait
  // then reads the recorded response through the typed path of a composed client.
  const sendTransaction = vi.fn<Runtime["sendTransaction"]>(
    options.sendTransaction ??
      (async (txLike): Promise<ccc.Hex> => {
        await Promise.resolve();
        return commitTransaction(responses, txLike);
      }),
  );
  // The bot's client is a JSON-RPC one: the stub answers the raw status poll from the
  // scripted body, as the node would.
  const runtime = botRuntime({
    client: new StubClient({
      getTransactionNoCache: async (
        txHash,
      ): ReturnType<ccc.Client["getTransactionNoCache"]> => {
        await Promise.resolve();
        return responses.get(ccc.hexFrom(txHash));
      },
      ...options.client,
    }),
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
  // The emitter writes JSON lines to stdout; the harness parses them back.
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    const parsed: unknown = JSON.parse(String(chunk));
    if (typeof parsed !== "object" || parsed === null) {
      throw new TypeError("Expected a JSON object line");
    }
    events.push(parsed);
    return true;
  });
  return {
    context: {
      events: new BotEventEmitter({ chain: "testnet", runId: "run-1" }),
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
    withdrawalGroups: options.withdrawal === true ? [testWithdrawal("62")] : [],
  });
}

function commitTransaction(
  responses: Map<ccc.Hex, ccc.ClientTransactionResponse>,
  txLike: ccc.TransactionLike,
): ccc.Hex {
  const transaction = ccc.Transaction.from(txLike);
  responses.set(
    transaction.hash(),
    committedTransactionResponse(transaction, { blockNumber: 1n }),
  );
  return transaction.hash();
}

function hashScript(byte: string): ccc.Script {
  return ccc.Script.from({ codeHash: hash(byte), hashType: "type", args: "0x" });
}

function eventTypes(events: object[]): string[] {
  return events.map((event) => ("type" in event ? String(event.type) : ""));
}

describe("readBotState pool snapshot", () => {
  it("uses the required SDK pool snapshot without storing a readiness copy", async () => {
    const tip = headerLike({ number: 10n, epoch: [0n, 0n, 1n], timestamp: "0x0" });
    const readyWindowEnd = POOL_MAX_LOCK_UP.add(tip.epoch).toUnix(tip);
    const ready = readyDeposit("33", 1n, 1n, { isReady: true });
    const tooEarly = readyDeposit("34", 2n, readyWindowEnd - 1n, { isReady: false });
    const nearReady = readyDeposit("35", 3n, readyWindowEnd + 1n, {
      isReady: false,
    });
    const future = readyDeposit("36", 4n, readyWindowEnd + 60n * 60n * 1000n, {
      isReady: false,
    });
    const getL1AccountState = vi.fn<IckbSdk["getL1AccountState"]>();
    getL1AccountState.mockResolvedValue({
      system: {
        tip,
        exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
        orderPool: [],
        feeRate: 1n,
        poolDeposits: [ready, tooEarly, nearReady, future],
      },
      user: { orders: [] },
      account: {
        capacityCells: [],
        nativeUdtCells: [],
        receipts: [],
        withdrawalGroups: [],
      },
    });
    const findDeposits = vi.fn(async (): Promise<IckbDepositCell[]> => {
      await Promise.resolve();
      return NO_DEPOSITS;
    });
    const runtime = botRuntime({
      sdk: { getL1AccountState },
      managers: { ickbLogic: { findDeposits } },
    });

    const state = await readBotState(runtime);

    expect(getL1AccountState).toHaveBeenCalledTimes(1);
    expect(getL1AccountState.mock.calls[0]?.[2]).toMatchObject({
      poolDeposits: { minLockUp: POOL_MIN_LOCK_UP, maxLockUp: POOL_MAX_LOCK_UP },
    });
    expect(findDeposits).not.toHaveBeenCalled();
    expect(state.poolDeposits).toEqual([ready, tooEarly, nearReady, future]);
    expect("readyPoolDeposits" in state).toBe(false);
  });
});

describe("readBotState", () => {
  it("ignores own orders and projects account availability", async () => {
    const ownOrder = await testOrderGroup("46", 7n);
    const marketOrder = (await testMatch("47")).group;
    const capacityCell = ccc.Cell.from({
      outPoint: { txHash: `0x${"44".repeat(32)}`, index: 0n },
      cellOutput: { capacity: 5n, lock: script("44") },
      outputData: "0x",
    });
    const nativeUdtCell = ccc.Cell.from({
      outPoint: { txHash: `0x${"48".repeat(32)}`, index: 0n },
      cellOutput: { capacity: 0n, lock: script("44") },
      outputData: ccc.numLeToBytes(11n, 16),
    });
    const getL1AccountState = vi.fn<IckbSdk["getL1AccountState"]>();
    getL1AccountState.mockResolvedValue({
      system: {
        tip: headerLike(),
        exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
        orderPool: [marketOrder],
        feeRate: 1n,
        poolDeposits: [],
      },
      user: { orders: [ownOrder] },
      account: {
        capacityCells: [capacityCell],
        nativeUdtCells: [nativeUdtCell],
        receipts: [],
        withdrawalGroups: [],
      },
    });

    const state = await readBotState(botRuntime({ sdk: { getL1AccountState } }));

    // Own orders do not exist for the bot: not in the market, not in the balances.
    expect(state.marketOrders).toEqual([marketOrder]);
    expect(state.ckb).toBe(
      capacityCell.cellOutput.capacity + nativeUdtCell.cellOutput.capacity,
    );
    expect(state.ickb).toBe(11n);
    expect(state.pendingCkb).toBe(0n);
    expect(state.cells).toEqual([capacityCell, nativeUdtCell]);
  });
});

async function testOrderGroup(byte: string, ckbValue: bigint): Promise<OrderGroup> {
  const order = (await testMatch(byte)).group.order;
  order.cell.cellOutput.capacity = ckbValue;
  return new OrderGroup(
    new MasterCell(
      ccc.Cell.from({
        outPoint: { txHash: `0x${"45".repeat(32)}`, index: 0n },
        cellOutput: { capacity: 0n, lock: script("45") },
        outputData: "0x",
      }),
    ),
    order,
    order,
  );
}
