import { describe, expect, it } from "vitest";
import { classifyActorResult } from "../../../../src/supervisor/index.ts";
import {
  CKB_TO_ICKB_DIRECTION,
  CLASSIFICATION_SUITE,
  DUST_AMOUNT,
  DUST_CKB_CONVERSION_SCENARIO,
  MIXED_DIRECTION_SCENARIO,
  MULTI_ORDER_SCENARIO,
  RANDOM_ORDER_SCENARIO,
  TWO_CKB_TO_ICKB_SCENARIO,
  TWO_ICKB_TO_CKB_SCENARIO,
  commandResult,
  multiOrderResult,
  txHash,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("classifies dust tester order evidence without satisfying useful order coverage", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          requestedTesterScenario: "auto",
          testerScenario: DUST_CKB_CONVERSION_SCENARIO,
          newOrder: {
            giveCkb: DUST_AMOUNT,
            takeIckb: DUST_AMOUNT,
            fee: "0",
            feeNumerator: "1",
            feeBase: "100000",
          },
          cancelledOrders: 1,
        },
        txHash: txHash("17"),
        ElapsedSeconds: 1,
      }),
    );

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "tester_dust_order_created",
      testerOrder: {
        requestedTesterScenario: "auto",
        testerScenario: DUST_CKB_CONVERSION_SCENARIO,
        orderCount: 1,
        cancelledOrders: 1,
        orders: [
          {
            direction: CKB_TO_ICKB_DIRECTION,
            giveCkb: DUST_AMOUNT,
            takeIckb: DUST_AMOUNT,
            fee: "0",
            feeNumerator: "1",
            feeBase: "100000",
            dust: true,
          },
        ],
      },
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("does not classify mixed dust and non-dust tester orders as dust-only", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: TWO_CKB_TO_ICKB_SCENARIO,
          newOrders: [
            { giveCkb: DUST_AMOUNT, takeIckb: DUST_AMOUNT, fee: "0" },
            { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          ],
          orderCount: 2,
          cancelledOrders: 0,
        },
        txHash: txHash("27"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, {
        scenario: TWO_CKB_TO_ICKB_SCENARIO,
      }),
    ).toMatchObject({
      outcome: "tester_order_created",
      testerOrder: {
        orders: [
          { direction: CKB_TO_ICKB_DIRECTION, dust: true },
          { direction: CKB_TO_ICKB_DIRECTION, dust: false },
        ],
      },
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("accepts either order direction for explicit random-order evidence", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: RANDOM_ORDER_SCENARIO,
          newOrder: { giveIckb: "10", takeCkb: "9", fee: "0.1" },
          cancelledOrders: 0,
        },
        txHash: txHash("18"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, {
        scenario: RANDOM_ORDER_SCENARIO,
      }),
    ).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("accepts explicit two-order CKB-to-iCKB tester scenario evidence", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: TWO_CKB_TO_ICKB_SCENARIO,
          newOrders: [
            { giveCkb: "10", takeIckb: "9", fee: "0.1" },
            { giveCkb: "20", takeIckb: "18", fee: "0.2" },
          ],
          orderCount: 2,
          cancelledOrders: 0,
        },
        txHash: txHash("19"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, {
        scenario: TWO_CKB_TO_ICKB_SCENARIO,
      }),
    ).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("accepts any concrete multi-order evidence for generic multi-order tester expectations", () => {
    const mixedResult = multiOrderResult(MIXED_DIRECTION_SCENARIO, "20");
    const ckbResult = multiOrderResult(TWO_CKB_TO_ICKB_SCENARIO, "21");
    const ickbResult = multiOrderResult(TWO_ICKB_TO_CKB_SCENARIO, "22");

    expect(
      classifyActorResult("tester", mixedResult, {
        scenario: MULTI_ORDER_SCENARIO,
      }),
    ).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
    expect(
      classifyActorResult("tester", ckbResult, {
        scenario: MULTI_ORDER_SCENARIO,
      }),
    ).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
    expect(
      classifyActorResult("tester", ickbResult, {
        scenario: MULTI_ORDER_SCENARIO,
      }),
    ).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects non-multi-order evidence for generic multi-order tester expectations", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: RANDOM_ORDER_SCENARIO,
          newOrders: [
            { giveCkb: "10", takeIckb: "9", fee: "0.1" },
            { giveIckb: "20", takeCkb: "18", fee: "0.2" },
          ],
          orderCount: 2,
          cancelledOrders: 0,
        },
        txHash: txHash("23"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, { scenario: MULTI_ORDER_SCENARIO }),
    ).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason:
        "tester scenario multi-order-limit-orders committed with non-multi-order selected scenario evidence",
    });
  });
});
