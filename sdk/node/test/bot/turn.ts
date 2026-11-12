import { ccc } from "@ckb-ccc/core";
import { addMatch } from "../../../src/order/order.ts";

import { headerLike, script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOT_LOCK_UP } from "../../../src/dao.ts";
import { MasterCell, OrderGroup } from "../../../src/order/cells.ts";
import type { CommitStep } from "../../../src/send/commit_transaction.ts";
import { readRawState } from "../../../src/state.ts";
import { BotEventEmitter } from "../../src/bot/events.ts";
import { readBotState, runBotTurn, type BotTurnContext } from "../../src/bot/turn.ts";
import type { Runtime } from "../../src/bot/types.ts";
import { CKB_RESERVE } from "../../src/shared/reserve.ts";
import {
  BAND_ICKB_BALANCE,
  BOT_TIP,
  botRuntime,
  botSystem,
  hash,
  l1AccountState,
  PLANNED_FEE,
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
const BUDGET_MS = 120_000;
// The commit takes each step after `sent` 10 s after the previous one.
const STEP_MS = 10_000;

// Calls through to the real builder unless a test injects a failure.
vi.mock(import("../../../src/order/order.ts"), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, addMatch: vi.fn(original.addMatch) };
});

// Each test serves the read it needs; the real one would scan the stub client.
vi.mock(import("../../../src/state.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  readRawState: vi.fn(),
}));

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
  expect(harness.commitTransaction).not.toHaveBeenCalled();
});

it("journals what the turn read: the tip, the projected balances, and the counts", async () => {
  const account = fundedAccount();
  const pending = testWithdrawal("63", undefined, false);
  account.account.withdrawalGroups.push(pending);
  account.system.poolDeposits = [readyDeposit("64", 1n), readyDeposit("65", 1n, 15n)];
  const harness = turnHarness({ account });

  await runBotTurn(harness.context);
  const { ckbConvertible } = await readBotState(harness.context.runtime);

  const ckb = [
    ...account.account.capacityCells,
    ...account.account.nativeUdtCells,
  ].reduce((sum, cell) => sum + cell.cellOutput.capacity, 0n);
  const pendingCkb = pending.ckbValue;
  const { epoch } = BOT_TIP;
  expect(harness.events[0]).toMatchObject({
    type: BOT_STATE_READ,
    chainTip: {
      blockNumber: String(BOT_TIP.number),
      blockHash: BOT_TIP.hash,
      timestamp: String(BOT_TIP.timestamp),
      epoch: {
        integer: String(epoch.integer),
        numerator: String(epoch.numerator),
        denominator: String(epoch.denominator),
      },
    },
    balances: {
      ckb: String(ckb),
      ickb: String(BAND_ICKB_BALANCE),
      pendingCkb: String(pendingCkb),
      // At the one-to-one test rate an iCKB counts as one CKB.
      totalEquivalentCkb: String(ckb + pendingCkb + BAND_ICKB_BALANCE),
      // What the match may spend: one transaction's CKB Max, less the reserve.
      matchableCkb: String(ckbConvertible - CKB_RESERVE),
      cellCount: 2,
    },
    counts: {
      marketOrders: 0,
      receipts: 0,
      readyWithdrawals: 0,
      pendingWithdrawals: 1,
      poolDeposits: 2,
      readyPoolDeposits: 1,
    },
    exchangeRatio: { ckbScale: "1", udtScale: "1" },
    depositCapacity: String(account.system.depositCapacity),
    feeRate: "1",
  });
});

it("keeps turning below the recommended funding instead of holding", async () => {
  const harness = turnHarness({ account: l1AccountState() });

  await runBotTurn(harness.context);

  expect(process.exitCode).toBeUndefined();
  expect(eventTypes(harness.events)).toEqual([BOT_STATE_READ, "bot.decision.skipped"]);
  expect(harness.commitTransaction).not.toHaveBeenCalled();
});

it("commits explicitly and journals the commit at the step that finds it", async () => {
  // A CKB-rich, iCKB-poor account refills its iCKB with one deposit.
  const harness = turnHarness({
    account: fundedAccount({ ckb: ccc.fixedPointFrom(200_000), ickb: 0n }),
  });

  await expect(harness.run()).resolves.toBeUndefined();

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
    elapsedMs: 0,
  });
  // The planned fee the send refuses to exceed is the one the built decision journaled.
  expect(harness.commitTransaction.mock.calls[0]?.[0].plannedFee).toBe(PLANNED_FEE);
  expect(harness.events[1]).toMatchObject({
    decision: { plannedFee: String(PLANNED_FEE) },
  });
  expect(harness.events[3]).toMatchObject({
    txHash: harness.sentHash(),
    elapsedMs: STEP_MS,
  });
});

it("ends the turn with the error the commit throws before any step", async () => {
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    steps: () => {
      throw new Error("transaction broadcast failed");
    },
  });

  await expect(harness.run()).resolves.toMatchObject({
    name: "Error",
    message: "transaction broadcast failed",
  });
  expect(eventTypes(harness.events)).toEqual([BOT_STATE_READ, BOT_TRANSACTION_BUILT]);
});

it.each(["not-signed", "expired"] as const)(
  "ends the turn with nothing sent on %s",
  async (reason) => {
    const harness = turnHarness({
      account: fundedAccount({ withdrawal: true }),
      steps: (txHash) => [{ ok: false, reason, txHash }],
    });

    const failure = await harness.run();

    expect(failure).toEqual(
      new Error(`Transaction ${harness.sentHash()} ${reason}`, {
        cause: { ok: false, reason, txHash: harness.sentHash() },
      }),
    );
    expect(eventTypes(harness.events)).toEqual([BOT_STATE_READ, BOT_TRANSACTION_BUILT]);
  },
);

it("journals an ambiguous send with its failure and follows the same hash", async () => {
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    steps: (txHash) => [
      { ok: true, status: "sent", txHash, cause: new TypeError(FETCH_FAILED) },
      { ok: true, status: "committed", txHash },
    ],
  });

  await expect(harness.run()).resolves.toBeUndefined();

  expect(harness.commitTransaction).toHaveBeenCalledTimes(1);
  expect(eventTypes(harness.events)).toEqual([
    BOT_STATE_READ,
    BOT_TRANSACTION_BUILT,
    BOT_TRANSACTION_SENT,
    BOT_TRANSACTION_COMMITTED,
  ]);
  expect(harness.events[2]).toMatchObject({
    txHash: harness.sentHash(),
    outcome: "broadcast_ambiguous",
    error: { name: "TypeError", message: FETCH_FAILED },
  });
  expect(harness.events[3]).toMatchObject({ txHash: harness.sentHash() });
});

it("follows a clean pending send for two minutes, then ends unresolved without a failure", async () => {
  const harness = turnHarness({
    account: fundedAccount({ withdrawal: true }),
    steps: (txHash) => [
      { ok: true, status: "sent", txHash },
      ...Array.from({ length: 20 }, (): CommitStep => ({
        ok: true,
        status: "pending",
        txHash,
      })),
      { ok: true, status: "committed", txHash },
    ],
  });

  let settled = false;
  const turn = (async (): Promise<void> => {
    await runBotTurn(harness.context);
    settled = true;
  })();
  await vi.advanceTimersByTimeAsync(BUDGET_MS - 1);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await turn;

  expect(eventTypes(harness.events)).toEqual([
    BOT_STATE_READ,
    BOT_TRANSACTION_BUILT,
    BOT_TRANSACTION_SENT,
    "bot.transaction.unresolved",
  ]);
  expect(harness.events[3]).toEqual(
    expect.objectContaining({ txHash: harness.sentHash() }),
  );
  expect(harness.events[3]).not.toHaveProperty("elapsedMs");
  // The turn stopped the commit at the step two minutes after the send.
  expect(harness.stepsTaken()).toBe(1 + BUDGET_MS / STEP_MS);
});

it.each([
  {
    name: "a step pending with a failed read",
    step: { ok: true, status: "pending", cause: new TypeError(FETCH_FAILED) },
    word: "pending",
  },
  {
    name: "the node's rejection",
    step: { ok: false, reason: "rejected", cause: new Error("Resolve failed Dead") },
    word: "rejected",
  },
  {
    name: "an abandoned send",
    step: { ok: false, reason: "abandoned", cause: new TypeError(FETCH_FAILED) },
    word: "abandoned",
  },
] as const)(
  "ends the turn at once, naming the hash, on $name",
  async ({ step, word }) => {
    const harness = turnHarness({
      account: fundedAccount({ withdrawal: true }),
      steps: (txHash) => [
        { ok: true, status: "sent", txHash },
        { ...step, txHash },
      ],
    });

    // The first step after the send fails the turn, without waiting out the budget.
    const failure = await harness.run(STEP_MS);

    expect(failure).toEqual(
      new Error(`Transaction ${harness.sentHash()} ${word}`, {
        cause: { ...step, txHash: harness.sentHash() },
      }),
    );
    expect(eventTypes(harness.events).at(-1)).toBe(BOT_TRANSACTION_SENT);
  },
);

it("propagates the read failure with nothing sent", async () => {
  const harness = turnHarness({
    readRawState: async () => {
      await Promise.resolve();
      throw new TypeError(FETCH_FAILED);
    },
  });

  await expect(runBotTurn(harness.context)).rejects.toMatchObject({
    name: "TypeError",
    message: FETCH_FAILED,
  });
  expect(harness.commitTransaction).not.toHaveBeenCalled();
  expect(harness.events).toEqual([]);
});

it("propagates a build failure after the state event", async () => {
  vi.mocked(addMatch).mockImplementationOnce(() => {
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
    readRawState?: typeof readRawState;
    /** The commit's steps for the sent transaction's hash; by default sent, then committed. */
    steps?: (txHash: ccc.Hex) => CommitStep[];
  } = {},
): {
  context: BotTurnContext;
  events: object[];
  commitTransaction: ReturnType<typeof vi.fn<Runtime["commitTransaction"]>>;
  run: (clockMs?: number) => Promise<unknown>;
  sentHash: () => ccc.Hex;
  stepsTaken: () => number;
} {
  // Far from zero, so a time measured from the epoch instead of the send shows.
  vi.useFakeTimers({ now: 1_000_000 });
  const account = options.account ?? fundedAccount();
  const events: object[] = [];
  const steps =
    options.steps ??
    ((txHash: ccc.Hex): CommitStep[] => [
      { ok: true, status: "sent", txHash },
      { ok: true, status: "committed", txHash },
    ]);
  let stepsTaken = 0;
  const commitTransaction = vi.fn<Runtime["commitTransaction"]>(async function* ({ tx }) {
    for (const [index, step] of steps(ccc.Transaction.from(tx).hash()).entries()) {
      await new Promise((resolve) => {
        setTimeout(resolve, index === 0 ? 0 : STEP_MS);
      });
      stepsTaken += 1;
      yield step;
    }
  });
  const runtime = botRuntime({ commitTransaction });
  vi.mocked(readRawState).mockImplementation(
    options.readRawState ??
      (async (): Promise<L1AccountState> => {
        await Promise.resolve();
        return account;
      }),
  );
  // The emitter writes JSON lines to stdout; the harness parses them back.
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    const parsed: unknown = JSON.parse(String(chunk));
    if (typeof parsed !== "object" || parsed === null) {
      throw new TypeError("Expected a JSON object line");
    }
    events.push(parsed);
    return true;
  });
  const context = {
    events: new BotEventEmitter({ chain: "testnet", processId: "run" }),
    runtime,
  };
  return {
    context,
    events,
    commitTransaction,
    // A whole turn, its clock run `clockMs` (by default the budget); it resolves to what
    // the turn threw, caught at once so a failure isn't unhandled while the clock runs.
    run: async (clockMs = BUDGET_MS): Promise<unknown> => {
      const turn = (async (): Promise<unknown> => {
        try {
          await runBotTurn(context);
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      await vi.advanceTimersByTimeAsync(clockMs);
      return turn;
    },
    sentHash: (): ccc.Hex => {
      const tx = commitTransaction.mock.calls[0]?.[0].tx;
      if (tx === undefined) {
        throw new Error("Nothing was sent");
      }
      return ccc.Transaction.from(tx).hash();
    },
    stepsTaken: (): number => stepsTaken,
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

function hashScript(byte: string): ccc.Script {
  return ccc.Script.from({ codeHash: hash(byte), hashType: "type", args: "0x" });
}

function eventTypes(events: object[]): string[] {
  return events.map((event) => ("type" in event ? String(event.type) : ""));
}

describe("readBotState pool snapshot", () => {
  it("reads the state under the bot's timing policy and keeps the pool as given", async () => {
    const tip = headerLike({ number: 10n, epoch: [0n, 0n, 1n], timestamp: "0x0" });
    const pool = [readyDeposit("33", 1n), readyDeposit("34", 2n, 15n)];
    vi.mocked(readRawState).mockResolvedValue({
      system: { ...botSystem(), tip, poolDeposits: pool },
      userOrders: [],
      account: {
        capacityCells: [],
        nativeUdtCells: [],
        receipts: [],
        withdrawalGroups: [],
      },
    });
    // The runtime's client is offline and fails any scan, so the read rescans no pool.
    const runtime = botRuntime();

    const state = await readBotState(runtime);

    expect(readRawState).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readRawState).mock.calls[0]?.[2]).toBe(BOT_LOCK_UP);
    expect(state.poolDeposits).toEqual(pool);
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
    vi.mocked(readRawState).mockResolvedValue({
      system: { ...botSystem(), tip: headerLike(), orderBook: [marketOrder] },
      userOrders: [ownOrder],
      account: {
        capacityCells: [capacityCell],
        nativeUdtCells: [nativeUdtCell],
        receipts: [],
        withdrawalGroups: [],
      },
    });

    const state = await readBotState(botRuntime());

    // Own orders do not exist for the bot: not in the market, not in the balances.
    expect(state.orderBook).toEqual([marketOrder]);
    expect(state.ckbAvailable).toBe(
      capacityCell.cellOutput.capacity + nativeUdtCell.cellOutput.capacity,
    );
    expect(state.ickbAvailable).toBe(11n);
    expect(state.ckbBalance).toBe(state.ckbAvailable);
    expect(state.cells).toEqual([capacityCell, nativeUdtCell]);
    expect(state.feeRate).toBe(1n);
  });

  it("asks the state read to cap the fee rate at the runtime's maximum", async () => {
    vi.mocked(readRawState).mockResolvedValue(l1AccountState());
    const runtime = botRuntime();

    await readBotState({ ...runtime, maxFeeRate: 1000n });

    expect(vi.mocked(readRawState).mock.calls[0]?.[3]).toBe(1000n);
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
    headerLike(),
  );
}
