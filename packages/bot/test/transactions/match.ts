import { ccc } from "@ckb-ccc/core";
import { OrderManager, Ratio, type MatchDiagnostics } from "@ickb/order";
import { headerLike, script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RebalanceDiagnostics,
  RebalancePlan,
  RingSegmentDiagnostics,
} from "../../src/policy.ts";
import { CKB_RESERVE } from "../../src/policy/constants.ts";
import { buildDecisionTranscript } from "../../src/runtime/decision.ts";
import { MAX_OUTPUTS_BEFORE_CHANGE } from "../../src/runtime/support.ts";
import { buildTransaction } from "../../src/runtime/transaction.ts";
import type {
  BotActions,
  BotDecisionTranscript,
  BotMatchReason,
} from "../../src/runtime/types.ts";
import {
  botRuntime,
  botState,
  completeSearchResult,
  hash,
  incompleteSearchResult,
  readyDeposit,
  TARGET_ICKB_BALANCE,
  testMatch,
} from "../bot/fixtures/bot.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildTransaction match allowance reserve", () => {
  it("preserves the bot available CKB reserve when matching orders", async () => {
    const bestMatch = vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [],
      }),
    );

    await buildTransaction(
      botRuntime(),
      botState({
        availableCkbBalance: ccc.fixedPointFrom(5000),
        availableIckbBalance: TARGET_ICKB_BALANCE,
      }),
    );

    expect(bestMatch.mock.calls[0]?.[1]).toMatchObject({
      ckbValue: ccc.fixedPointFrom(3999),
    });
  });

  it("keeps fee headroom out of CKB-consuming match allowance", async () => {
    const bestMatch = vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [],
      }),
    );

    await buildTransaction(
      botRuntime(),
      botState({
        availableCkbBalance: CKB_RESERVE + ccc.fixedPointFrom(2),
        availableIckbBalance: TARGET_ICKB_BALANCE,
      }),
    );

    expect(bestMatch.mock.calls[0]?.[1]).toMatchObject({
      ckbValue: ccc.fixedPointFrom(1),
    });
  });
});

describe("buildTransaction incomplete empty match maintenance", () => {
  it("builds independent collection and rebalance actions with search evidence", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      incompleteSearchResult({ ckbDelta: 0n, udtDelta: 0n, partials: [] }),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const buildBaseTransaction = vi.fn((txLike: ccc.TransactionLike) =>
      ccc.Transaction.from(txLike),
    );
    const deposit = vi.fn((txLike: ccc.TransactionLike) => ccc.Transaction.from(txLike));

    const result = await buildTransaction(
      botRuntime({
        sdk: { buildBaseTransaction },
        managers: { logic: { deposit } },
      }),
      botState({
        marketOrders: [testMatch("79").group],
        userOrders: [testMatch("7a").group],
        availableCkbBalance: ccc.fixedPointFrom(3000),
        availableIckbBalance: TARGET_ICKB_BALANCE + CKB_RESERVE,
        depositCapacity: ccc.fixedPointFrom(1000),
        totalCkbBalance: ccc.fixedPointFrom(3000),
      }),
    );

    expect(result).toMatchObject({
      kind: "built",
      actions: { collectedOrders: 1, matchedOrders: 0, deposits: 1 },
      decision: {
        match: { reason: "search_incomplete", search: { kind: "incomplete" } },
        rebalance: { kind: "deposit", reason: "ring_inventory" },
      },
    });
    expect(buildBaseTransaction).toHaveBeenCalledTimes(1);
    expect(deposit).toHaveBeenCalledTimes(1);
  });
});

describe("buildTransaction incomplete empty match skip", () => {
  it("returns an explicit incomplete-search skip after checking maintenance", async () => {
    const diagnostics = { ...matchDiagnostics(), workCount: 7 };
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      kind: "incomplete",
      match: { ckbDelta: 0n, udtDelta: 0n, partials: [], diagnostics },
      reason: "candidate_budget_exhausted",
      searchMode: "stepped",
      budget: 7,
      work: 7,
      truncation: { phase: "candidates", requiredWork: 8n },
    });
    const buildBaseTransaction = vi.fn((txLike: ccc.TransactionLike) =>
      ccc.Transaction.from(txLike),
    );
    const completeTransaction = vi.fn();

    const result = await buildTransaction(
      botRuntime({ sdk: { buildBaseTransaction }, completeTransaction }),
      botState({ marketOrders: [testMatch("76").group] }),
    );

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "match_search_incomplete",
      decision: {
        match: {
          reason: "search_incomplete",
          diagnostics,
          search: { kind: "incomplete", reason: "candidate_budget_exhausted" },
        },
        rebalance: { kind: "none" },
        skip: {
          reason: "match_search_incomplete",
          matchSearch: {
            kind: "incomplete",
            reason: "candidate_budget_exhausted",
            searchMode: "stepped",
            budget: 7,
            work: 7,
            truncation: { phase: "candidates", requiredWork: 8n },
          },
        },
      },
    });
    expect(buildBaseTransaction).toHaveBeenCalledTimes(1);
    expect(completeTransaction).not.toHaveBeenCalled();
  });

  it("propagates unexpected match search failures", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockImplementation(() => {
      throw new Error("unexpected match failure");
    });

    await expect(buildTransaction(botRuntime(), botState({}))).rejects.toThrow(
      "unexpected match failure",
    );
  });
});

describe("buildTransaction match-only fee profitability", () => {
  it("skips match-only transactions when the completed fee consumes the match value", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      incompleteSearchResult({
        ckbDelta: 1n,
        udtDelta: 0n,
        partials: [testMatch("67")],
      }),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);

    const state = botState({
      marketOrders: [testMatch("68").group],
      availableCkbBalance: CKB_RESERVE,
      availableIckbBalance: TARGET_ICKB_BALANCE,
      totalCkbBalance: CKB_RESERVE,
    });

    const result = await buildTransaction(
      botRuntime({ primaryLock: script("11") }),
      state,
    );

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "match_value_not_above_fee",
      actions: { matchedOrders: 0 },
      decision: {
        match: { search: { kind: "incomplete" } },
        actions: { matchedOrders: 0 },
        skip: {
          reason: "match_value_not_above_fee",
          fee: 1n,
          matchValue: 1n,
          attemptedActions: { matchedOrders: 1 },
        },
      },
    });
  });
});

describe("buildTransaction incomplete positive match", () => {
  it("executes an incomplete positive match through final profitability", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      incompleteSearchResult({
        ckbDelta: 2n,
        udtDelta: 0n,
        partials: [testMatch("77")],
      }),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const completeTransaction = vi.fn(
      async (txLike: ccc.TransactionLike): Promise<ccc.Transaction> => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      },
    );

    const result = await buildTransaction(
      botRuntime({ completeTransaction, primaryLock: script("11") }),
      botState({
        marketOrders: [testMatch("78").group],
        availableCkbBalance: CKB_RESERVE,
        availableIckbBalance: TARGET_ICKB_BALANCE,
        totalCkbBalance: CKB_RESERVE,
      }),
    );

    expect(result).toMatchObject({
      kind: "built",
      actions: { matchedOrders: 1 },
      decision: { match: { search: { kind: "incomplete" } } },
    });
    expect(completeTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("buildTransaction exchange-ratio profitability", () => {
  it("uses the repo exchange-ratio scale when checking match-only profitability", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({
        ckbDelta: -2n,
        udtDelta: 2n,
        partials: [testMatch("70")],
      }),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);

    const state = botState({
      marketOrders: [testMatch("71").group],
      availableCkbBalance: CKB_RESERVE + 3n,
      availableIckbBalance: TARGET_ICKB_BALANCE,
      totalCkbBalance: CKB_RESERVE + 3n,
      system: {
        feeRate: 1n,
        exchangeRatio: Ratio.from({ ckbScale: 3n, udtScale: 5n }),
        orderPool: [],
        poolDeposits: { deposits: [], id: "pool" },
        ckbAvailable: 0n,
        ckbMaturing: [],
        tip: headerLike(),
      },
    });

    await expect(
      buildTransaction(botRuntime({ primaryLock: script("11") }), state),
    ).resolves.toMatchObject({
      kind: "built",
      actions: { matchedOrders: 1 },
    });
  });
});

describe("buildTransaction match decision labels", () => {
  it("labels built match and deposit-rebalance decisions", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({
        ckbDelta: 0n,
        udtDelta: 1n,
        partials: [testMatch("69")],
      }),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);

    const state = botState({
      marketOrders: [testMatch("6a").group],
      availableCkbBalance: ccc.fixedPointFrom(2000),
      availableIckbBalance: 0n,
      depositCapacity: 100n,
      totalCkbBalance: ccc.fixedPointFrom(2000),
    });

    await expect(
      buildTransaction(botRuntime({ primaryLock: script("11") }), state),
    ).resolves.toMatchObject({
      kind: "built",
      decision: {
        match: {
          reason: "matched",
          matchedOrderOutPoints: [{ txHash: hash("69"), index: "1" }],
          matchedOrderMasterOutPoints: [{ txHash: hash("69"), index: "2" }],
        },
        rebalance: { kind: "deposit", reason: "ring_inventory" },
      },
    });
  });
});

describe("buildTransaction output boundary", () => {
  it("skips candidates whose actual pre-change outputs exceed the output limit", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [],
      }),
    );
    const buildBaseTransaction = vi.fn((txLike: ccc.TransactionLike) => {
      const tx = ccc.Transaction.from(txLike);
      for (let index = 0; index <= MAX_OUTPUTS_BEFORE_CHANGE; index += 1) {
        tx.addOutput({ capacity: 0n, lock: script("44") }, "0x");
      }
      return tx;
    });
    const completeTransaction = vi.fn(async (txLike: ccc.TransactionLike) => {
      await Promise.resolve();
      return ccc.Transaction.from(txLike);
    });

    const result = await buildTransaction(
      botRuntime({ sdk: { buildBaseTransaction }, completeTransaction }),
      botState({
        availableCkbBalance: ccc.fixedPointFrom(2000),
        availableIckbBalance: 0n,
        depositCapacity: 100n,
        totalCkbBalance: ccc.fixedPointFrom(2000),
      }),
    );

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "output_limit",
      actions: { deposits: 0 },
      decision: {
        skip: {
          reason: "output_limit",
          attemptedActions: { deposits: 1 },
        },
      },
    });
    expect(completeTransaction).not.toHaveBeenCalled();
  });
});

describe("buildDecisionTranscript match miss labels", () => {
  it.each([
    ["no_matchable_orders", matchDiagnostics({ ckbMatchable: 0, udtMatchable: 0 })],
    [
      "insufficient_allowance",
      matchDiagnostics({ viable: 0, insufficientCkbAllowance: 1 }),
    ],
    ["no_viable_candidates", matchDiagnostics({ viable: 0 })],
    ["no_viable_candidates", undefined],
    ["no_viable_candidates", matchDiagnostics({ viable: 1, positiveGain: 1 })],
    ["max_partials", matchDiagnostics({ viable: 1, maxPartials: 1 })],
    [
      "insufficient_allowance",
      matchDiagnostics({ viable: 1, insufficientUdtAllowance: 1 }),
    ],
    ["no_positive_gain", matchDiagnostics({ viable: 1 })],
  ] satisfies Array<[BotMatchReason, MatchDiagnostics | undefined]>)(
    "labels %s",
    (reason, diagnostics) => {
      expect(
        buildDecisionTranscript({
          runtime: botRuntime(),
          state: botState({ marketOrders: [testMatch("72").group] }),
          match: { ckbDelta: 0n, udtDelta: 0n, partials: [], diagnostics },
          rebalance: { kind: "none", reason: "no_withdrawable_ickb" },
          outputSlots: 58,
          actions: {
            collectedOrders: 0,
            completedDeposits: 0,
            matchedOrders: 0,
            deposits: 0,
            withdrawalRequests: 0,
            withdrawals: 0,
          },
          tx: ccc.Transaction.default(),
        }).match.reason,
      ).toBe(reason);
    },
  );
});

describe("buildDecisionTranscript withdrawal summaries", () => {
  it("records required live deposits for withdrawal rebalances", () => {
    const selected = readyDeposit("73", 1n, 20n * 60n * 1000n);
    const requiredLive = readyDeposit("74", 1n, 25n * 60n * 1000n);

    expect(
      transcriptForRebalance(
        {
          kind: "withdraw",
          reason: "excess_ickb_balance",
          deposits: [selected],
          requiredLiveDeposits: [requiredLive],
        },
        { withdrawalRequests: 1 },
      ).rebalance,
    ).toMatchObject({
      withdrawalRequestCount: 1,
      requiredLiveDepositCount: 1,
    });
  });

  it("defaults required live deposits to zero", () => {
    const selected = readyDeposit("75", 1n, 20n * 60n * 1000n);

    expect(
      transcriptForRebalance(
        {
          kind: "withdraw",
          reason: "excess_ickb_balance",
          deposits: [selected],
        },
        { withdrawalRequests: 1 },
      ).rebalance,
    ).toMatchObject({ requiredLiveDepositCount: 0 });
  });
});

describe("buildDecisionTranscript selected ring summaries", () => {
  it("summarizes the heaviest selected ring segment", () => {
    expect(
      transcriptForRebalance({
        kind: "none",
        reason: "no_withdrawable_ickb",
        diagnostics: ringDiagnostics(),
      }).audit.selectedRing,
    ).toMatchObject({
      targetDepositCount: 0,
      heaviestSegmentIndex: 1,
      heaviestSegmentDepositCount: 2,
      heaviestSegmentUdtValue: 4n,
    });
  });
});

function transcriptForRebalance(
  rebalance: RebalancePlan,
  actionOverrides: Partial<BotActions> = {},
): BotDecisionTranscript {
  return buildDecisionTranscript({
    runtime: botRuntime(),
    state: botState({}),
    match: { ckbDelta: 0n, udtDelta: 0n, partials: [] },
    rebalance,
    outputSlots: 58,
    actions: {
      collectedOrders: 0,
      completedDeposits: 0,
      matchedOrders: 0,
      deposits: 0,
      withdrawalRequests: 0,
      withdrawals: 0,
      ...actionOverrides,
    },
    tx: ccc.Transaction.default(),
  });
}

function ringDiagnostics(): RebalanceDiagnostics {
  return {
    ring: {
      poolDepositCount: 2,
      canCreateRingInventory: true,
      shouldBootstrapRing: false,
      ringLength: 180n,
      segmentCount: 2,
      targetSegmentIndex: 0,
      targetSegmentUdtValue: 0n,
      totalPoolUdt: 4n,
      depositsShareOneSegment: false,
      segments: [
        ringSegment({ index: 0, depositCount: 0, udtValue: 0n, isTarget: true }),
        ringSegment({ index: 1, depositCount: 2, udtValue: 4n, isTarget: false }),
      ],
    },
  };
}

function ringSegment(
  segment: Pick<
    RingSegmentDiagnostics,
    "depositCount" | "index" | "isTarget" | "udtValue"
  >,
): RingSegmentDiagnostics {
  return {
    ...segment,
    protectedDepositCount: 0,
    protectedUdtValue: 0n,
    protectedOutPoints: [],
    surplusDepositCount: segment.depositCount,
    surplusUdtValue: segment.udtValue,
    surplusOutPoints: [],
  };
}

function matchDiagnostics(
  overrides: Partial<{
    ckbMatchable: number;
    udtMatchable: number;
    viable: number;
    positiveGain: number;
    maxPartials: number;
    insufficientCkbAllowance: number;
    insufficientUdtAllowance: number;
  }> = {},
): MatchDiagnostics {
  return {
    orderCount: 1,
    allowance: { ckbValue: 0n, udtValue: 0n },
    ckbAllowanceStep: 1n,
    udtAllowanceStep: 1n,
    ckbMiningFee: 1n,
    candidateBudget: 100_000,
    workCount: 1,
    generatedStates: {
      ckbToUdt: overrides.ckbMatchable ?? 1,
      udtToCkb: overrides.udtMatchable ?? 1,
    },
    directions: {
      ckbToUdt: { matchableCount: overrides.ckbMatchable ?? 1 },
      udtToCkb: { matchableCount: overrides.udtMatchable ?? 1 },
    },
    candidates: {
      total: 1,
      viable: overrides.viable ?? 0,
      positiveGain: overrides.positiveGain ?? 0,
      rejected: {
        maxPartials: overrides.maxPartials ?? 0,
        duplicateOrder: 0,
        insufficientCkbAllowance: overrides.insufficientCkbAllowance ?? 0,
        insufficientUdtAllowance: overrides.insufficientUdtAllowance ?? 0,
        nonPositiveGain: 0,
      },
      bestGain: 0n,
    },
  };
}
