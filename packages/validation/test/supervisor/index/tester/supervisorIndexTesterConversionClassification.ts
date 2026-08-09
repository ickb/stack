import { describe, expect, it } from "vitest";
import { classifyActorResult } from "../../../../src/supervisor/index.ts";
import {
  CLASSIFICATION_SUITE,
  ICKB_TO_CKB_SCENARIO,
  INVALID_TX_HASH,
  commandResult,
  txHash,
} from "../../support/supervisor/index.ts";

const MISSING_ACTION_EVIDENCE_REASON =
  "tester committed transaction evidence did not include action evidence";

describe(CLASSIFICATION_SUITE, () => {
  it("classifies tester order creation", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          cancelledOrders: 0,
        },
        txHash: txHash("11"),
        ElapsedSeconds: 1,
      }),
    );

    expect(classifyActorResult("tester", result).outcome).toBe("tester_order_created");
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies tester direct conversions separately from order creation", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: { conversion: { kind: "direct" }, cancelledOrders: 0 },
        txHash: txHash("12"),
        ElapsedSeconds: 1,
      }),
    );

    expect(classifyActorResult("tester", result).outcome).toBe(
      "tester_conversion_created",
    );
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies tester hybrid direct-plus-order conversions as conversion coverage", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          conversion: { kind: "direct-plus-order" },
          newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          cancelledOrders: 0,
        },
        txHash: txHash("13"),
        ElapsedSeconds: 1,
      }),
    );

    expect(classifyActorResult("tester", result).outcome).toBe(
      "tester_conversion_created",
    );
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects committed tester evidence without a valid tx hash", () => {
    expect(
      classifyActorResult(
        "tester",
        commandResult(
          "tester",
          JSON.stringify({
            startTime: "now",
            actions: {
              newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" },
              cancelledOrders: 0,
            },
            txHash: INVALID_TX_HASH,
            ElapsedSeconds: 1,
          }),
        ),
      ),
    ).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester committed transaction evidence did not include a valid tx hash",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects committed tester evidence without action evidence", () => {
    expect(
      classifyActorResult(
        "tester",
        commandResult(
          "tester",
          JSON.stringify({
            startTime: "now",
            txHash: txHash("25"),
            ElapsedSeconds: 1,
          }),
        ),
      ),
    ).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: MISSING_ACTION_EVIDENCE_REASON,
    });
    expect(
      classifyActorResult(
        "tester",
        commandResult(
          "tester",
          JSON.stringify({
            startTime: "now",
            actions: { cancelledOrders: 0 },
            txHash: txHash("26"),
            ElapsedSeconds: 1,
          }),
        ),
      ),
    ).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: MISSING_ACTION_EVIDENCE_REASON,
    });
    expect(
      classifyActorResult(
        "tester",
        commandResult(
          "tester",
          JSON.stringify({
            startTime: "now",
            actions: {
              newOrders: [
                { giveCkb: "10", takeIckb: "9" },
                { giveCkb: "10", takeIckb: "9", giveIckb: "10", takeCkb: "9" },
              ],
              cancelledOrders: 0,
            },
            txHash: txHash("29"),
            ElapsedSeconds: 1,
          }),
        ),
      ),
    ).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: MISSING_ACTION_EVIDENCE_REASON,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects committed tester order evidence without exactly one direction", () => {
    expect(
      classifyActorResult(
        "tester",
        commandResult(
          "tester",
          JSON.stringify({
            startTime: "now",
            actions: { newOrder: {}, cancelledOrders: 0 },
            txHash: txHash("27"),
            ElapsedSeconds: 1,
          }),
        ),
      ),
    ).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: MISSING_ACTION_EVIDENCE_REASON,
    });
    expect(
      classifyActorResult(
        "tester",
        commandResult(
          "tester",
          JSON.stringify({
            startTime: "now",
            actions: {
              newOrder: {
                giveCkb: "10",
                takeIckb: "9",
                giveIckb: "10",
                takeCkb: "9",
              },
              cancelledOrders: 0,
            },
            txHash: txHash("28"),
            ElapsedSeconds: 1,
          }),
        ),
      ),
    ).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: MISSING_ACTION_EVIDENCE_REASON,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies tester SDK order conversions as conversion coverage", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          conversion: { kind: "order" },
          newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          cancelledOrders: 0,
        },
        txHash: txHash("14"),
        ElapsedSeconds: 1,
      }),
    );

    expect(classifyActorResult("tester", result).outcome).toBe(
      "tester_conversion_created",
    );
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("accepts explicit iCKB-to-CKB tester scenario evidence", () => {
    const result = commandResult(
      "tester",
      JSON.stringify({
        startTime: "now",
        actions: {
          testerScenario: ICKB_TO_CKB_SCENARIO,
          newOrder: { giveIckb: "10", takeCkb: "9", fee: "0.1" },
          collectedOrders: 2,
          cancelledOrders: 1,
        },
        txHash: txHash("15"),
        ElapsedSeconds: 1,
      }),
    );

    expect(
      classifyActorResult("tester", result, { scenario: ICKB_TO_CKB_SCENARIO }),
    ).toMatchObject({
      outcome: "tester_order_created",
      terminal: false,
      testerOrder: {
        testerScenario: ICKB_TO_CKB_SCENARIO,
        orderCount: 1,
        collectedOrders: 2,
        cancelledOrders: 1,
        orders: [
          {
            direction: "ickb-to-ckb",
            giveIckb: "10",
            takeCkb: "9",
            fee: "0.1",
            dust: false,
          },
        ],
      },
    });
  });
});
