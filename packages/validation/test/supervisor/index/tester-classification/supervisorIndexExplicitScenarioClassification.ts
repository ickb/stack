import { describe, expect, it } from "vitest";
import { classifyActorResult } from "../../../../src/supervisor/index.ts";
import {
  BOUNDED_ICKB_TO_CKB_SCENARIO,
  CLASSIFICATION_SUITE,
  FRESH_MATCHABLE_ORDER,
  ICKB_TO_CKB_SCENARIO,
  MIXED_DIRECTION_SCENARIO,
  POST_TX_CKB_RESERVE,
  RANDOM_ORDER_SCENARIO,
  SDK_CONVERSION_SCENARIO,
  commandResult,
  testerSkipClassification,
  txHash,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("rejects ambiguous mixed-direction order evidence", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: MIXED_DIRECTION_SCENARIO,
          newOrders: [
            {
              giveCkb: "10",
              takeIckb: "9",
              giveIckb: "20",
              takeCkb: "18",
              fee: "0.1",
            },
            "not-an-order",
          ],
          orderCount: 2,
          cancelledOrders: 0,
        },
        txHash: txHash("1f"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, {
        scenario: MIXED_DIRECTION_SCENARIO,
      }),
    ).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason:
        "tester scenario mixed-direction-limit-orders committed without mixed order direction evidence",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects committed tester evidence that does not match the explicit scenario", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: ICKB_TO_CKB_SCENARIO,
          newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          cancelledOrders: 0,
        },
        txHash: txHash("16"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, { scenario: ICKB_TO_CKB_SCENARIO }),
    ).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason:
        "tester scenario ickb-to-ckb-limit-order committed with wrong order direction evidence",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("accepts bounded iCKB-to-CKB tester scenario evidence", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: BOUNDED_ICKB_TO_CKB_SCENARIO,
          newOrder: { giveIckb: "10", takeCkb: "9", fee: "0.1" },
          cancelledOrders: 0,
        },
        txHash: txHash("18"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, {
        scenario: BOUNDED_ICKB_TO_CKB_SCENARIO,
      }),
    ).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("accepts conversion evidence for explicit SDK conversion scenarios", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: SDK_CONVERSION_SCENARIO,
          conversion: { kind: "direct" },
          cancelledOrders: 0,
        },
        txHash: txHash("18"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, { scenario: SDK_CONVERSION_SCENARIO }),
    ).toMatchObject({ outcome: "tester_conversion_created", terminal: false });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("requires conversion evidence for explicit SDK conversion scenarios", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: SDK_CONVERSION_SCENARIO,
          newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          cancelledOrders: 0,
        },
        txHash: txHash("17"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, {
        scenario: SDK_CONVERSION_SCENARIO,
      }),
    ).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason: "tester scenario sdk-conversion committed without conversion evidence",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies tester fresh-order and sampled-too-small skips", () => {
    expect(testerSkipClassification(FRESH_MATCHABLE_ORDER, "22").outcome).toBe(
      "tester_fresh_order_skip",
    );
    expect(
      testerSkipClassification("matchable-order-transaction-missing", "23"),
    ).toMatchObject({
      outcome: "tester_fresh_order_skip",
      terminal: false,
      skipReason: "matchable-order-transaction-missing",
    });
    expect(testerSkipClassification("sampled-amount-too-small").outcome).toBe(
      "tester_sampled_too_small_skip",
    );
    expect(
      classifyActorResult(
        "tester",
        commandResult(
          "tester",
          JSON.stringify({
            skip: {
              reason: "estimated-conversion-too-small",
              requestedTesterScenario: "auto",
              attemptedTesterScenarios: [
                RANDOM_ORDER_SCENARIO,
                SDK_CONVERSION_SCENARIO,
                BOUNDED_ICKB_TO_CKB_SCENARIO,
              ],
            },
          }),
        ),
      ),
    ).toMatchObject({
      outcome: "tester_estimated_too_small_skip",
      terminal: false,
      skipReason: "estimated-conversion-too-small",
    });
    expect(
      classifyActorResult(
        "tester",
        commandResult(
          "tester",
          JSON.stringify({ skip: { reason: POST_TX_CKB_RESERVE } }),
        ),
      ),
    ).toMatchObject({
      outcome: "tester_reserve_skip",
      terminal: false,
      skipReason: POST_TX_CKB_RESERVE,
    });
  });
});
