import { ccc } from "@ckb-ccc/core";
import { completeTransaction } from "../../../../src/complete.ts";
import { partialOrderFee } from "../../../../src/order/fee.ts";
import { addMatch } from "../../../../src/order/order.ts";

import { StubClient } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTransaction } from "../../../src/bot/transaction.ts";
import { CKB_RESERVE } from "../../../src/shared/reserve.ts";
import {
  BAND_ICKB_BALANCE,
  botRuntime,
  botState,
  hash,
  marketOrder,
  PLANNED_FEE,
  testReceipt,
  testWithdrawal,
} from "../fixtures/bot.ts";

// Calls through to the real builder unless a test injects a failure.
vi.mock(import("../../../../src/order/order.ts"), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, addMatch: vi.fn(original.addMatch) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildTransaction matching", () => {
  it("offers the CKB above the reserve to a seller", async () => {
    // The seller hands over twice its CKB ask in iCKB, whole only.
    const ask = ccc.fixedPointFrom(4000);
    const seller = marketOrder({
      byte: "30",
      ckb: 0n,
      udt: 2n * ask,
      ratio: { ckbScale: 2n, udtScale: 1n },
      ckbMinMatchLog: 44,
    });
    const state = (ckb: bigint): ReturnType<typeof botState> =>
      botState({
        orderBook: [seller],
        ckbAvailable: ckb,
        ickbAvailable: BAND_ICKB_BALANCE,
      });

    const short = await buildTransaction(botRuntime(), state(CKB_RESERVE + ask - 1n));
    const enough = await buildTransaction(botRuntime(), state(CKB_RESERVE + ask));

    expect(short.decision.match).toMatchObject({
      reason: "unfunded_gain",
      candidates: 1,
      gains: 1,
    });
    expect(enough.decision.match).toMatchObject({ reason: "matched", partialCount: 1 });
  });

  it("funds a fill sized to the whole matchable CKB through the real completer", async () => {
    // The completed transaction's fee and the bot's new iCKB cell come out of the reserve;
    // testnet's fee rate, so the fee is far above one partial's.
    const feeRate = 33_222n;
    const ask = ccc.fixedPointFrom(4000);
    const seller = marketOrder({
      byte: "34",
      ckb: 0n,
      udt: 2n * ask,
      ratio: { ckbScale: 2n, udtScale: 1n },
      ckbMinMatchLog: 44,
    });
    // Completion spends the cells it is given and never scans; the testnet stub carries
    // the known scripts the signer needs.
    const client = new StubClient();
    const signer = new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
    const { script: primaryLock } = await signer.getRecommendedAddressObj();
    const plain = ccc.Cell.from({
      outPoint: { txHash: hash("35"), index: 0n },
      cellOutput: { capacity: CKB_RESERVE + ask, lock: primaryLock },
      outputData: "0x",
    });
    const runtime = botRuntime({
      client,
      primaryLock,
      completeTransaction: async (tx, state) =>
        completeTransaction(tx, { ...state, signer }),
    });
    const base = botState({});

    const result = await buildTransaction(
      runtime,
      botState({
        orderBook: [seller],
        ckbAvailable: plain.cellOutput.capacity,
        ickbAvailable: BAND_ICKB_BALANCE,
        cells: [plain],
        system: { ...base.system, feeRate },
      }),
    );

    expect(result.decision.match).toMatchObject({ reason: "matched", partialCount: 1 });
    expect(result.kind).toBe("built");
  });

  it("skips with no_actions when the book, the collections, and the rebalance are all empty", async () => {
    const result = await buildTransaction(
      botRuntime(),
      botState({
        ckbAvailable: ccc.fixedPointFrom(5000),
        ickbAvailable: BAND_ICKB_BALANCE,
      }),
    );

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "no_actions",
      decision: {
        match: { reason: "no_market_orders", candidates: 0 },
        core: { kind: "none", attempts: 0 },
      },
    });
    expect(result.decision.match).not.toHaveProperty("matchedOrderOutPoints");
  });

  it("tells a book that gains but the balances cannot pay from one that never gains", async () => {
    const buyer = (ratio: {
      ckbScale: bigint;
      udtScale: bigint;
    }): ReturnType<typeof marketOrder> =>
      marketOrder({ byte: "31", ckb: ccc.fixedPointFrom(200), udt: 0n, ratio });

    // A buyer paying two CKB per iCKB gains; the bot holds no iCKB to serve it.
    await expect(
      buildTransaction(
        botRuntime(),
        botState({
          orderBook: [buyer({ ckbScale: 1n, udtScale: 2n })],
          ckbAvailable: CKB_RESERVE,
          ickbAvailable: 0n,
        }),
      ),
    ).resolves.toMatchObject({
      kind: "skipped",
      reason: "no_actions",
      decision: {
        match: { reason: "unfunded_gain", partialCount: 0, candidates: 1, gains: 1 },
      },
    });
    // A buyer at par never returns the cost of a fill, whatever the bot holds.
    await expect(
      buildTransaction(
        botRuntime(),
        botState({
          orderBook: [buyer({ ckbScale: 1n, udtScale: 1n })],
          ckbAvailable: CKB_RESERVE,
          ickbAvailable: ccc.fixedPointFrom(1000),
        }),
      ),
    ).resolves.toMatchObject({
      decision: {
        match: { reason: "no_gain", partialCount: 0, candidates: 1, gains: 0 },
      },
    });
  });

  it("propagates unexpected match failures", async () => {
    vi.mocked(addMatch).mockImplementationOnce(() => {
      throw new Error("match failed");
    });

    await expect(buildTransaction(botRuntime(), botState({}))).rejects.toThrow(
      "match failed",
    );
  });

  it("propagates what the completion throws", async () => {
    const runtime = botRuntime({
      completeTransaction: async () => {
        await Promise.resolve();
        throw new TypeError("fetch failed");
      },
    });
    const buyer = marketOrder({
      byte: "36",
      ckb: ccc.fixedPointFrom(200),
      udt: 0n,
      ratio: { ckbScale: 1n, udtScale: 2n },
    });

    await expect(
      buildTransaction(
        runtime,
        botState({
          orderBook: [buyer],
          ckbAvailable: CKB_RESERVE,
          ickbAvailable: BAND_ICKB_BALANCE,
        }),
      ),
    ).rejects.toThrow("fetch failed");
  });

  it("builds a gaining match with its evidence", async () => {
    // The buyer pays two CKB per iCKB against a one-to-one rate.
    const buyer = marketOrder({
      byte: "32",
      ckb: ccc.fixedPointFrom(200),
      udt: 0n,
      ratio: { ckbScale: 1n, udtScale: 2n },
    });

    const result = await buildTransaction(
      botRuntime(),
      botState({
        orderBook: [buyer],
        ckbAvailable: ccc.fixedPointFrom(5000),
        ickbAvailable: BAND_ICKB_BALANCE,
      }),
    );

    expect(result).toMatchObject({
      kind: "built",
      decision: {
        actions: { matchedOrders: 1, deposits: 0, withdrawalRequests: 0 },
        match: {
          reason: "matched",
          partialCount: 1,
          ckbDelta: ccc.fixedPointFrom(200),
          udtDelta: -ccc.fixedPointFrom(100),
          matchedOrderOutPoints: [{ index: "0" }],
          candidates: 1,
          fee: partialOrderFee([buyer], 1n),
        },
        core: { kind: "none", attempts: 1 },
        plannedFee: PLANNED_FEE,
      },
    });
    expect(typeof result.decision.match.seed).toBe("number");
  });

  it("sends collections alone and counts them only when built", async () => {
    const runtime = botRuntime();
    const state = botState({
      ckbAvailable: ccc.fixedPointFrom(5000),
      ickbAvailable: BAND_ICKB_BALANCE,
      receipts: [testReceipt("37")],
      readyWithdrawals: [testWithdrawal("33")],
    });

    const result = await buildTransaction(runtime, state);

    if (result.kind !== "built") {
      throw new Error("Expected a built transaction");
    }
    // The receipt, then the ready withdrawal request and its owner marker.
    const [withdrawal] = state.readyWithdrawals;
    expect(result.tx.inputs.map(({ previousOutput }) => previousOutput.toHex())).toEqual([
      state.receipts[0]?.cell.outPoint.toHex(),
      withdrawal?.owned.cell.outPoint.toHex(),
      withdrawal?.owner.cell.outPoint.toHex(),
    ]);
    expect(result).toMatchObject({
      kind: "built",
      decision: {
        actions: { matchedOrders: 0, completedDeposits: 1, withdrawals: 1 },
        core: { kind: "none" },
      },
    });
    const unfunded = botRuntime({
      completeTransaction: async () => {
        await Promise.resolve();
        return {
          ok: false,
          reason: "insufficient-capacity",
          cause: new ccc.ErrorTransactionInsufficientCapacity(1n),
        };
      },
    });
    await expect(buildTransaction(unfunded, state)).resolves.toMatchObject({
      kind: "skipped",
      reason: "no_fundable_candidate",
      decision: {
        actions: { completedDeposits: 0, withdrawals: 0 },
        core: { kind: "none", attempts: 1 },
      },
    });
  });
});
