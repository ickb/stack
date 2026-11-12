import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConversionTransaction } from "../../../src/build.ts";
import {
  completeTransaction,
  type CompleteTransactionResult,
} from "../../../src/complete.ts";
import { ICKB_UDT, ORDER } from "../../../src/constants.ts";
import { OrderCell } from "../../../src/order/cells.ts";
import { DEFAULT_ORDER_FEE_BASE } from "../../../src/order/conversion.ts";
import {
  commitTransaction,
  type CommitStep,
} from "../../../src/send/commit_transaction.ts";
import { readState } from "../../../src/state.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { CKB_RESERVE } from "../../src/shared/reserve.ts";
import type { Override } from "../../src/stimulus/draw.ts";
import { MAX_LIVE_ORDERS, type Runtime } from "../../src/stimulus/state.ts";
import {
  runStimulusTurn,
  type StimulusIdentity,
  type StimulusLog,
} from "../../src/stimulus/turn.ts";
import {
  accountState,
  CKB,
  order,
  plainCell,
  PRIMARY_LOCK,
  receipt,
  runtime,
  systemState,
} from "./support/fixtures.ts";

vi.mock(import("../../../src/send/commit_transaction.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  commitTransaction: vi.fn(),
}));
// The fixture runtime serves its state as the signer's read.
vi.mock(import("../../../src/state.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  readState: vi.fn(),
}));
// The real builder and completer unless a test scripts one.
vi.mock(import("../../../src/build.ts"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    buildConversionTransaction: vi.fn(original.buildConversionTransaction),
  };
});
vi.mock(import("../../../src/complete.ts"), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, completeTransaction: vi.fn(original.completeTransaction) };
});

const commitMock = vi.mocked(commitTransaction);
const completeMock = vi.mocked(completeTransaction);
const buildMock = vi.mocked(buildConversionTransaction);
const SHORTFALL = {
  ok: false,
  reason: "insufficient-capacity",
  cause: new ccc.ErrorTransactionInsufficientCapacity(1n),
} as const;
const TX_HASH = byte32FromByte("46");
const DEADLINE = { epoch: ccc.Epoch.from([5n, 0n, 1n]), tipMaxAgeMs: 1_800_000 };
const identity: StimulusIdentity = {
  chain: "testnet",
  address: "ckt1stimulus",
  primaryLock: { codeHash: PRIMARY_LOCK.codeHash, hashType: "type", args: "0x" },
  rpcEndpoints: [{ protocol: "https:", hostname: "testnet.example", port: "" }],
};
const FUNDED_CKB = 6000n * CKB;
const BUDGET_MS = 120_000;
// The commit takes each step after `sent` 10 s after the previous one.
const STEP_MS = 10_000;
// The first broadcast takes this long before `sent`, so the budget counts from the send.
const SEND_MS = 15_000;
const SENT: CommitStep = { ok: true, status: "sent", txHash: TX_HASH };
const PLANNED_FEE = 1000n;
const fundedAccount = accountState({ capacityCells: [plainCell(FUNDED_CKB, "b1")] });
const orderDraw: Override = {
  kind: "order",
  direction: "ckb-to-ickb",
  amount: 5n * CKB,
  fee: 1n,
};
let lines: string[] = [];

beforeEach(() => {
  lines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk): boolean => {
    lines.push(String(chunk));
    return true;
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "Date", "performance"] });
  committing([SENT, { ok: true, status: "committed", txHash: TX_HASH }]);
  completeMock.mockReset();
  buildMock.mockReset();
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Every commit from here on yields `steps`. */
function committing(steps: readonly CommitStep[]): void {
  commitMock.mockReset();
  commitMock.mockImplementation(async function* () {
    for (const [index, step] of steps.entries()) {
      await new Promise((resolve) => {
        setTimeout(resolve, index === 0 ? SEND_MS : STEP_MS);
      });
      yield step;
    }
  });
}

/** The transaction the turn handed the sender on its `call`th send. */
function sentTx(call = 0): ccc.Transaction {
  const built = commitMock.mock.calls[call]?.[1];
  if (built === undefined) {
    throw new Error("Expected a sent transaction");
  }
  return ccc.Transaction.from(built.tx);
}

/** The order output of the `call`th sent transaction, its first output. */
function sentOrder(call = 0): OrderCell {
  const output = sentTx(call).getOutput(0);
  if (output === undefined) {
    throw new Error("Expected a sent order output");
  }
  return OrderCell.mustFrom(
    ccc.Cell.from({
      cellOutput: output.cellOutput,
      outputData: output.outputData,
      outPoint: { txHash: TX_HASH, index: 0n },
    }),
    0n,
  );
}

/** Completion from here on spends the funded cell and returns `change` CKB to the account. */
function completing(change: bigint): void {
  completeMock.mockImplementation(async (txLike): Promise<CompleteTransactionResult> => {
    await Promise.resolve();
    const tx = ccc.Transaction.from(txLike).clone();
    tx.addInput(plainCell(FUNDED_CKB, "b1"));
    tx.addOutput({ capacity: change, lock: PRIMARY_LOCK });
    return { ok: true, tx, plannedFee: PLANNED_FEE };
  });
}

/** One turn, its clock run past the step after the send. */
async function turn(target: Runtime, override: Override = {}): Promise<StimulusLog> {
  const running = runStimulusTurn({
    runtime: target,
    identity,
    override,
    random: () => 0.5,
  });
  await vi.advanceTimersByTimeAsync(SEND_MS + BUDGET_MS);
  await running;
  expect(lines).toHaveLength(1);
  const parsed: unknown = JSON.parse(lines[0] ?? "");
  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("Expected one log object");
  }
  return parsed;
}

describe("runStimulusTurn", () => {
  it("stops minting at the live-order cap and still collects", async () => {
    const fresh = await order("a2", true, undefined, 1_000_000n);
    const live = Array.from({ length: MAX_LIVE_ORDERS }, () => fresh);
    buildMock.mockImplementation(async (_signer, state, _direction, amount) => {
      await Promise.resolve();
      expect({ amount, state }).toMatchObject({ amount: 0n, state: { receipts: [{}] } });
      return {
        ok: true,
        tx: ccc.Transaction.default(),
        plannedFee: PLANNED_FEE,
        estimatedMaturity: 0n,
        conversionKind: "collect-only",
        orderOccupiedCapacity: 0n,
        broadcastBefore: DEADLINE,
      };
    });
    const target = runtime({
      account: accountState({
        capacityCells: [plainCell(FUNDED_CKB, "b1")],
        receipts: [receipt("c1", 100n * CKB, 50n * CKB)],
      }),
      orders: live,
    });
    const { ckbConvertible } = await readState(target.signer);
    const log = await turn(target, orderDraw);

    expect(sentTx().outputs.some(({ lock }) => lock.eq(ORDER))).toBe(false);
    // The SDK's broadcast deadline reaches the sender.
    expect(commitMock.mock.calls[0]?.[1].broadcastBefore).toBe(DEADLINE);
    expect(log).toMatchObject({
      outcome: "committed",
      orders: { live: MAX_LIVE_ORDERS, fulfilled: 0, refused: 0 },
      skip: { reason: "live-order-cap", live: MAX_LIVE_ORDERS },
      draw: { kind: "order", direction: "ckb-to-ickb" },
      action: { conversionKind: "collect-only" },
      balance: {
        CKB: { budget: ccc.fixedPointToString(ckbConvertible - CKB_RESERVE) },
        ICKB: { budget: "50" },
      },
    });
    expect(log).not.toHaveProperty("collectSkip");
  });

  it("still converts at the live-order cap", async () => {
    const fresh = await order("a2", true, undefined, 1_000_000n);
    buildMock.mockImplementation(async () => {
      await Promise.resolve();
      return { ok: false, reason: "amount-too-small", minimum: 1n };
    });
    const log = await turn(
      runtime({
        account: fundedAccount,
        orders: Array.from({ length: MAX_LIVE_ORDERS }, () => fresh),
      }),
      { ...orderDraw, kind: "conversion" },
    );

    expect(log).toMatchObject({ skip: { reason: "conversion-not-buildable" } });
  });

  it("skips a max draw on an empty side as it skips an unpinned one", async () => {
    const log = await turn(
      runtime({
        account: accountState({ capacityCells: [plainCell(6000n * CKB, "b1")] }),
      }),
      { kind: "conversion", direction: "ickb-to-ckb", amount: "max" },
    );

    expect(log).toMatchObject({
      outcome: "skipped",
      skip: { reason: "nothing-to-spend" },
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("skips when nothing is spendable and nothing is collectable", async () => {
    const log = await turn(
      runtime({
        account: accountState({ capacityCells: [plainCell(6000n * CKB, "b1")] }),
      }),
      { direction: "ickb-to-ckb" },
    );

    expect(log).toMatchObject({
      outcome: "skipped",
      skip: { reason: "nothing-to-spend" },
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("mints one order on the collection base and commits", async () => {
    const fulfilled = await order("a1", false);
    completing(5500n * CKB);
    const target = runtime({ account: fundedAccount, orders: [fulfilled] });

    const log = await turn(target, orderDraw);

    expect(log).toMatchObject({
      type: "stimulus.turn",
      timestamp: new Date(log.timestamp ?? "").toISOString(),
      identity,
      outcome: "committed",
      orders: { live: 0, fulfilled: 1, refused: 0 },
      draw: { kind: "order", direction: "ckb-to-ickb", amount: "500000000", fee: "1" },
      action: { order: { outputs: [0, 1] } },
      transactionShape: { inputs: 3, outputs: 3 },
      txFee: { fee: ccc.fixedPointToString(PLANNED_FEE) },
      txHash: TX_HASH,
    });
    // The send refuses a fee above the one completion planned, the one journaled.
    expect(commitMock.mock.calls[0]?.[1].plannedFee).toBe(PLANNED_FEE);
    expect(log).not.toHaveProperty("skip");
    const sent = sentTx();
    // The base carries the fulfilled order's two melt inputs before the mint.
    expect(sent.inputs.slice(0, 2).map(({ previousOutput }) => previousOutput)).toEqual([
      fulfilled.order.cell.outPoint,
      fulfilled.master.cell.outPoint,
    ]);
    // The minted order offers the drawn CKB for iCKB, its master at the primary lock.
    const minted = sentOrder();
    expect(minted.cell.cellOutput.type?.eq(ICKB_UDT)).toBe(true);
    expect(minted.data.info.ckbToUdt.isPopulated()).toBe(true);
    expect([minted.ckbUnoccupied, minted.udtValue]).toEqual([5n * CKB, 0n]);
    expect(sent.outputs[1]?.lock.eq(PRIMARY_LOCK)).toBe(true);
    expect(sent.outputs[1]?.type?.eq(ORDER)).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it("mints each direction's amount on its own side through the real mint", async () => {
    completing(5500n * CKB);
    const log = await turn(runtime({ account: fundedAccount }), {
      ...orderDraw,
      direction: "ickb-to-ckb",
      fee: 0n,
    });
    lines = [];
    completeMock.mockReset();
    // The real completer funds the CKB-to-iCKB order from the account's plain CKB.
    const completed = await turn(runtime({ account: fundedAccount }), orderDraw);

    expect(log).toMatchObject({
      outcome: "committed",
      draw: { kind: "order", direction: "ickb-to-ckb", fee: "0" },
      action: { order: { outputs: [0, 1] } },
      transactionShape: { inputs: 1, outputs: 3 },
    });
    expect(
      [sentOrder(0), sentOrder(1)].map(({ ckbUnoccupied, udtValue }) => [
        ckbUnoccupied,
        udtValue,
      ]),
    ).toEqual([
      [0n, 5n * CKB],
      [5n * CKB, 0n],
    ]);
    expect(completed).toMatchObject({
      outcome: "committed",
      transactionShape: { inputs: 1, outputs: 3 },
    });
  });

  it("falls back to collecting when the drawn action is refused", async () => {
    // A buy at par: the bot gains nothing on it, so it is collectable.
    const refused = await order("a3", true, systemState().exchangeRatio);
    buildMock.mockImplementation(async (_signer, state, _direction, amount) => {
      await Promise.resolve();
      expect({ amount, state }).toMatchObject({
        amount: 0n,
        state: { availableOrders: [refused] },
      });
      const tx = ccc.Transaction.default();
      tx.addInput(refused.order.cell);
      tx.addOutput({ capacity: 2050n * CKB, lock: PRIMARY_LOCK });
      return {
        ok: true,
        tx,
        plannedFee: PLANNED_FEE,
        estimatedMaturity: 0n,
        conversionKind: "collect-only",
        orderOccupiedCapacity: 0n,
        broadcastBefore: undefined,
      };
    });
    completing(500n * CKB);
    const log = await turn(
      runtime({
        account: fundedAccount,
        orders: [refused],
      }),
      { ...orderDraw, amount: 0n },
    );

    expect(log).toMatchObject({
      outcome: "committed",
      draw: { kind: "order", amount: "0" },
      skip: { reason: "unrepresentable-amount" },
      action: { conversionKind: "collect-only" },
    });
  });

  it("collects the receipts alone when the drawn conversion is refused", async () => {
    // The fallback fires on receipts, not only on orders.
    const target = runtime({
      account: accountState({ receipts: [receipt("c2", 300n * CKB, ICKB_DEPOSIT_CAP)] }),
    });
    completeMock.mockResolvedValue(SHORTFALL);

    const log = await turn(target, {
      kind: "conversion",
      direction: "ickb-to-ckb",
      amount: ICKB_DEPOSIT_CAP + 1n,
    });

    expect(buildMock.mock.calls.map(([, , , amount]) => amount)).toEqual([
      ICKB_DEPOSIT_CAP + 1n,
      0n,
    ]);
    // The journal keeps the drawn action and its refusal beside the collection's own.
    expect(log).toMatchObject({
      outcome: "skipped",
      draw: { kind: "conversion", direction: "ickb-to-ckb" },
      skip: { reason: "conversion-not-buildable" },
      collectSkip: {
        reason: "conversion-not-buildable",
        conversion: "insufficient-capacity",
      },
    });
  });

  it("skips amounts the order format cannot represent", async () => {
    const log = await turn(runtime({ account: fundedAccount }), {
      ...orderDraw,
      amount: 0n,
    });

    expect(log).toMatchObject({
      outcome: "skipped",
      skip: { reason: "unrepresentable-amount" },
    });
  });

  it("skips what the completer cannot fund, from either builder", async () => {
    completeMock.mockResolvedValue(SHORTFALL);
    const orderLog = await turn(runtime({ account: fundedAccount }), orderDraw);
    lines = [];
    buildMock.mockImplementation(async () => {
      await Promise.resolve();
      return SHORTFALL;
    });
    const conversionLog = await turn(runtime({ account: fundedAccount }), {
      ...orderDraw,
      kind: "conversion",
    });

    expect(orderLog).toMatchObject({
      outcome: "skipped",
      skip: {
        reason: "unfundable",
        failure: { ok: false, reason: "insufficient-capacity", cause: { amount: "1" } },
      },
    });
    // The SDK's build returns the shortfall as its value, a conversion it cannot build.
    expect(conversionLog).toMatchObject({
      outcome: "skipped",
      skip: { reason: "conversion-not-buildable", conversion: "insufficient-capacity" },
    });
  });

  it("logs the SDK's planning refusal as a skip", async () => {
    buildMock.mockImplementation(async () => {
      await Promise.resolve();
      return { ok: false, reason: "amount-too-small", minimum: 1n };
    });
    const log = await turn(runtime({ account: fundedAccount }), {
      ...orderDraw,
      kind: "conversion",
    });

    expect(log).toMatchObject({
      outcome: "skipped",
      skip: { reason: "conversion-not-buildable", conversion: "amount-too-small" },
    });
  });

  it("fails with exit 1 on any other error", async () => {
    const invalidFee = await turn(runtime({ account: fundedAccount }), {
      ...orderDraw,
      fee: DEFAULT_ORDER_FEE_BASE,
    });
    lines = [];
    completeMock.mockRejectedValue(new TypeError("fetch failed"));
    const log = await turn(runtime({ account: fundedAccount }), orderDraw);

    expect(invalidFee).toMatchObject({
      outcome: "failed",
      error: { message: "Fee too big relative to feeBase" },
    });
    expect(log).toMatchObject({ outcome: "failed", error: { message: "fetch failed" } });
    expect(process.exitCode).toBe(1);
  });

  it("follows a clean pending send for two minutes on a monotonic clock, then logs it unresolved", async () => {
    completing(5500n * CKB);
    committing([
      SENT,
      ...Array.from({ length: 20 }, (): CommitStep => ({
        ok: true,
        status: "pending",
        txHash: TX_HASH,
      })),
    ]);
    let settled = false;
    const running = (async (): Promise<void> => {
      await runStimulusTurn({
        runtime: runtime({ account: fundedAccount }),
        identity,
        override: orderDraw,
        random: () => 0.5,
      });
      settled = true;
    })();
    await vi.advanceTimersByTimeAsync(SEND_MS);
    // A wall clock stepped back an hour after the send doesn't stretch the budget.
    vi.setSystemTime(Date.now() - 3_600_000);
    await vi.advanceTimersByTimeAsync(BUDGET_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await running;

    const log: unknown = JSON.parse(lines[0] ?? "");
    expect(log).toMatchObject({ outcome: "unresolved", txHash: TX_HASH });
    expect(log).not.toHaveProperty("error");
    expect(process.exitCode).toBeUndefined();
  });

  it("fails on a step that ends the turn, keeping the hash once sent", async () => {
    completing(5500n * CKB);
    const outcomes = [];
    for (const steps of [
      [
        { ...SENT, cause: new TypeError("fetch failed") },
        {
          ok: false,
          reason: "rejected",
          txHash: TX_HASH,
          cause: new Error("dead input"),
        },
      ],
      [{ ok: false, reason: "not-signed", txHash: TX_HASH, cause: new Error("no") }],
      [
        SENT,
        {
          ok: true,
          status: "pending",
          txHash: TX_HASH,
          cause: new TypeError("fetch failed"),
        },
      ],
      [SENT, { ok: false, reason: "abandoned", txHash: TX_HASH }],
    ] satisfies CommitStep[][]) {
      committing(steps);
      outcomes.push(await turn(runtime({ account: fundedAccount }), orderDraw));
      lines = [];
    }
    commitMock.mockImplementation(() => {
      throw new TypeError("signer offline");
    });
    const offline = await turn(runtime({ account: fundedAccount }), orderDraw);
    const [rejected, unsigned, unread, abandoned] = outcomes;

    expect(rejected).toMatchObject({
      outcome: "rejected",
      txHash: TX_HASH,
      error: {
        message: `Transaction ${TX_HASH} rejected`,
        cause: { reason: "rejected", cause: { message: "dead input" } },
      },
    });
    // Nothing was sent, so no hash is logged.
    expect(unsigned).toMatchObject({
      outcome: "failed",
      error: {
        message: `Transaction ${TX_HASH} not-signed`,
        cause: { ok: false, reason: "not-signed" },
      },
    });
    expect(unsigned).not.toHaveProperty("txHash");
    // A read that failed leaves the sent transaction's fate unknown.
    expect(unread).toMatchObject({
      outcome: "unresolved",
      txHash: TX_HASH,
      error: {
        message: `Transaction ${TX_HASH} pending`,
        cause: { cause: { message: "fetch failed" } },
      },
    });
    expect(abandoned).toMatchObject({
      outcome: "unresolved",
      error: { message: `Transaction ${TX_HASH} abandoned` },
    });
    expect(offline).toMatchObject({
      outcome: "failed",
      error: { message: "signer offline" },
    });
    expect(process.exitCode).toBe(1);
  });
});
