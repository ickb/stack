import { ccc } from "@ckb-ccc/core";
import { TESTNET_SCRIPTS } from "@ckb-ccc/core/advanced";
import { OrderManager } from "../../../../src/order/index.ts";
import { partialOrderFee } from "../../../../src/order/io/order_io.ts";

import { chainState, FakeClient } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CKB_RESERVE } from "../../../src/bot/policy/constants.ts";
import { buildTransaction } from "../../../src/bot/runtime/transaction.ts";
import {
  BAND_ICKB_BALANCE,
  botRuntime,
  botState,
  hash,
  marketOrder,
  testWithdrawal,
} from "../fixtures/bot.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const RESERVE_CHANGE = ccc.fixedPointFrom(1500);

/** A completion that returns the reserve as plain change to the bot. */
function completing(change = RESERVE_CHANGE): Parameters<typeof botRuntime>[0] {
  return {
    completeTransaction: async (txLike): Promise<ccc.Transaction> => {
      await Promise.resolve();
      const tx = ccc.Transaction.from(txLike).clone();
      tx.addOutput({ capacity: change, lock: botRuntime().primaryLock }, "0x");
      return tx;
    },
  };
}

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
      botState({ marketOrders: [seller], ckb, ickb: BAND_ICKB_BALANCE });

    const short = await buildTransaction(
      botRuntime(completing()),
      state(CKB_RESERVE + ask - 1n),
    );
    const enough = await buildTransaction(
      botRuntime(completing()),
      state(CKB_RESERVE + ask),
    );

    expect(short.decision.match).toMatchObject({
      reason: "unfunded_gain",
      candidates: 1,
      gains: 1,
    });
    expect(enough.decision.match).toMatchObject({ reason: "matched", partialCount: 1 });
  });

  it("funds a fill sized to the whole matchable CKB through the real completer", async () => {
    // The completed transaction's fee and the bot's new iCKB cell come out of the reserve;
    // testnet's fee rate, so the fee is far above one partial's (N20, amendment 52(i)).
    const feeRate = 33_222n;
    const ask = ccc.fixedPointFrom(4000);
    const seller = marketOrder({
      byte: "34",
      ckb: 0n,
      udt: 2n * ask,
      ratio: { ckbScale: 2n, udtScale: 1n },
      ckbMinMatchLog: 44,
    });
    const chain = chainState().cell(seller.order.cell).cell(seller.master.cell);
    for (const known of Object.values(ccc.KnownScript)) {
      chain.knownScript(known, TESTNET_SCRIPTS[known]);
    }
    const client = new FakeClient(chain);
    const signer = new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
    const { script: primaryLock } = await signer.getRecommendedAddressObj();
    const plain = ccc.Cell.from({
      outPoint: { txHash: hash("35"), index: 0n },
      cellOutput: { capacity: CKB_RESERVE + ask, lock: primaryLock },
      outputData: "0x",
    });
    chain.cell(plain);
    const runtime = botRuntime({
      client,
      primaryLock,
      completeTransaction: async (tx, rate, cells) =>
        runtime.sdk.completeTransaction(tx, { signer, feeRate: rate, cells }),
    });
    const base = botState({});

    const result = await buildTransaction(
      runtime,
      botState({
        marketOrders: [seller],
        ckb: plain.cellOutput.capacity,
        ickb: BAND_ICKB_BALANCE,
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
      botState({ ckb: ccc.fixedPointFrom(5000), ickb: BAND_ICKB_BALANCE }),
    );

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "no_actions",
      decision: {
        match: { reason: "no_market_orders", candidates: 0 },
        core: { kind: "none", attempts: 0 },
      },
    });
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
          marketOrders: [buyer({ ckbScale: 1n, udtScale: 2n })],
          ckb: CKB_RESERVE,
          ickb: 0n,
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
          marketOrders: [buyer({ ckbScale: 1n, udtScale: 1n })],
          ckb: CKB_RESERVE,
          ickb: ccc.fixedPointFrom(1000),
        }),
      ),
    ).resolves.toMatchObject({
      decision: {
        match: { reason: "no_gain", partialCount: 0, candidates: 1, gains: 0 },
      },
    });
  });

  it("propagates unexpected match failures", async () => {
    vi.spyOn(OrderManager.prototype, "addMatch").mockImplementation(() => {
      throw new Error("match failed");
    });

    await expect(buildTransaction(botRuntime(), botState({}))).rejects.toThrow(
      "match failed",
    );
  });

  it("propagates completion failures that are not about fundability", async () => {
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
        botState({ marketOrders: [buyer], ckb: CKB_RESERVE, ickb: BAND_ICKB_BALANCE }),
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
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1000n);

    const result = await buildTransaction(
      botRuntime(completing()),
      botState({
        marketOrders: [buyer],
        ckb: ccc.fixedPointFrom(5000),
        ickb: BAND_ICKB_BALANCE,
      }),
    );

    expect(result).toMatchObject({
      kind: "built",
      actions: { matchedOrders: 1, deposits: 0, withdrawalRequests: 0 },
      decision: {
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
        fee: { estimated: 1000n },
      },
    });
    expect(typeof result.decision.match.seed).toBe("number");
  });

  it("sends collections alone and counts them", async () => {
    const runtime = botRuntime(completing());
    const withdraw = vi.spyOn(runtime.managers.ownedOwner, "withdraw");

    const result = await buildTransaction(
      runtime,
      botState({
        ckb: ccc.fixedPointFrom(5000),
        ickb: BAND_ICKB_BALANCE,
        readyWithdrawals: [testWithdrawal("33")],
      }),
    );

    expect(withdraw).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      kind: "built",
      actions: { matchedOrders: 0, withdrawals: 1 },
      decision: { core: { kind: "none" } },
    });
  });
});
