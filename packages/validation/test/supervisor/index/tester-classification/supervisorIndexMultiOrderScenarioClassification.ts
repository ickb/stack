import { describe, expect, it } from "vitest";
import { classifyActorResult } from "../../../../src/supervisor/index.ts";
import {
  CLASSIFICATION_SUITE,
  MIXED_DIRECTION_SCENARIO,
  MULTI_ORDER_SCENARIO,
  TWO_CKB_TO_ICKB_SCENARIO,
  TWO_ICKB_TO_CKB_SCENARIO,
  commandResult,
  txHash,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("rejects concrete direction mismatches for generic multi-order tester expectations", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          requestedTesterScenario: MULTI_ORDER_SCENARIO,
          testerScenario: MIXED_DIRECTION_SCENARIO,
          newOrders: [
            { giveCkb: "10", takeIckb: "9", fee: "0.1" },
            { giveCkb: "20", takeIckb: "18", fee: "0.2" },
          ],
          orderCount: 2,
          cancelledOrders: 0,
        },
        txHash: txHash("24"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, { scenario: MULTI_ORDER_SCENARIO }),
    ).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason:
        "tester scenario multi-order-limit-orders committed without mixed order direction evidence",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects wrong order count evidence for explicit two-order scenarios", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: TWO_CKB_TO_ICKB_SCENARIO,
          newOrders: [{ giveCkb: "10", takeIckb: "9", fee: "0.1" }],
          orderCount: 1,
          cancelledOrders: 0,
        },
        txHash: txHash("1a"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, {
        scenario: TWO_CKB_TO_ICKB_SCENARIO,
      }),
    ).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason:
        "tester scenario two-ckb-to-ickb-limit-orders committed without 2 new order evidence entries",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("accepts explicit two-order iCKB-to-CKB tester scenario evidence", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: TWO_ICKB_TO_CKB_SCENARIO,
          newOrders: [
            { giveIckb: "10", takeCkb: "9", fee: "0.1" },
            { giveIckb: "20", takeCkb: "18", fee: "0.2" },
          ],
          orderCount: 2,
          cancelledOrders: 0,
        },
        txHash: txHash("1b"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, {
        scenario: TWO_ICKB_TO_CKB_SCENARIO,
      }),
    ).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects wrong order direction evidence for explicit two-order iCKB-to-CKB scenarios", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: TWO_ICKB_TO_CKB_SCENARIO,
          newOrders: [
            { giveCkb: "10", takeIckb: "9", fee: "0.1" },
            { giveCkb: "20", takeIckb: "18", fee: "0.2" },
          ],
          orderCount: 2,
          cancelledOrders: 0,
        },
        txHash: txHash("1c"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, {
        scenario: TWO_ICKB_TO_CKB_SCENARIO,
      }),
    ).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason:
        "tester scenario two-ickb-to-ckb-limit-orders committed with wrong order direction evidence",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("accepts explicit mixed-direction tester scenario evidence", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: MIXED_DIRECTION_SCENARIO,
          newOrders: [
            { giveCkb: "10", takeIckb: "9", fee: "0.1" },
            { giveIckb: "20", takeCkb: "18", fee: "0.2" },
          ],
          orderCount: 2,
          cancelledOrders: 0,
        },
        txHash: txHash("1d"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, {
        scenario: MIXED_DIRECTION_SCENARIO,
      }),
    ).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects same-direction evidence for explicit mixed-direction scenarios", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: MIXED_DIRECTION_SCENARIO,
          newOrders: [
            { giveCkb: "10", takeIckb: "9", fee: "0.1" },
            { giveCkb: "20", takeIckb: "18", fee: "0.2" },
          ],
          orderCount: 2,
          cancelledOrders: 0,
        },
        txHash: txHash("1e"),
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
