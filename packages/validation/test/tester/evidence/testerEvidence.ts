import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import {
  attemptedOrderEvidence,
  testerAttemptedTransactionEvidence,
  testerEstimatedTooSmallSkip,
  testerExecutionActions,
  testerSdkConversionNoticeSkip,
} from "../../../src/tester/evidence/testerEvidence.ts";
import {
  CKB_TO_ICKB_DIRECTION,
  DIRECT_PLUS_ORDER_CONVERSION,
  DUST_CKB_CONVERSION_SCENARIO,
  DUST_ICKB_CONVERSION_SCENARIO,
  DUST_ICKB_TO_CKB_NOTICE,
  ESTIMATED_TOO_SMALL_REASON,
  ICKB_TO_CKB_DIRECTION,
  ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  ONE_SHANNON_TEXT,
  PLAN_TESTER_TRANSACTION,
  SDK_CONVERSION_SCENARIO,
  estimatedOrder,
  matchableOrder,
  nonMatchableOrder,
  testerState,
} from "../../support/tester/index.ts";

describe(`${PLAN_TESTER_TRANSACTION} raw order evidence`, () => {
  it("reports total collected owned orders separately from matchable cancelled orders", async () => {
    const actions = testerExecutionActions({
      requestedScenario: "auto",
      effectiveScenario: ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      conversion: undefined,
      conversionNotice: undefined,
      estimatedOrders: [
        estimatedOrder(
          ICKB_TO_CKB_DIRECTION,
          ccc.fixedPointFrom(12),
          ccc.fixedPointFrom(10),
          ccc.fixedPointFrom(11),
          ccc.fixedPointFrom(1),
        ),
      ],
      feePolicy: { fee: 1n, feeBase: 1000n },
      state: testerState({
        availableCkbBalance: ccc.fixedPointFrom(100),
        userOrders: [
          await matchableOrder(byte32FromByte("10")),
          await nonMatchableOrder(byte32FromByte("11")),
        ],
      }),
    });

    expect(actions).toEqual({
      requestedTesterScenario: "auto",
      testerScenario: ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      newOrder: {
        giveIckb: "11",
        takeCkb: "10",
        fee: "1",
        feeNumerator: "1",
        feeBase: "1000",
      },
      collectedOrders: 2,
      cancelledOrders: 1,
    });
  });

  it("keeps unbroadcast post-build reserve skips under attempted evidence", () => {
    const evidence = testerAttemptedTransactionEvidence(
      "auto",
      ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      undefined,
      {
        attemptedOrder: {
          giveIckb: "11",
          takeCkb: "10",
          fee: "1",
          feeNumerator: "1",
          feeBase: "1000",
        },
      },
    );

    expect(evidence).toEqual({
      requestedTesterScenario: "auto",
      testerScenario: ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      attemptedOrder: {
        giveIckb: "11",
        takeCkb: "10",
        fee: "1",
        feeNumerator: "1",
        feeBase: "1000",
      },
    });
    expect(evidence).not.toHaveProperty("newOrder");
    expect(evidence).not.toHaveProperty("newOrders");
  });
});

describe(`${PLAN_TESTER_TRANSACTION} grouped raw order evidence`, () => {
  it("reports multiple new and attempted orders as grouped evidence", () => {
    const feePolicy = { fee: 1n, feeBase: 1000n };
    const first = estimatedOrder(
      CKB_TO_ICKB_DIRECTION,
      ccc.fixedPointFrom(12),
      ccc.fixedPointFrom(12),
      ccc.fixedPointFrom(11),
      ccc.fixedPointFrom(1),
    );
    const second = estimatedOrder(
      ICKB_TO_CKB_DIRECTION,
      ccc.fixedPointFrom(5),
      ccc.fixedPointFrom(4),
      ccc.fixedPointFrom(5),
      ccc.fixedPointFrom(1),
    );

    expect(
      testerExecutionActions({
        requestedScenario: "auto",
        effectiveScenario: ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
        conversion: undefined,
        conversionNotice: undefined,
        estimatedOrders: [first, second],
        feePolicy,
        state: testerState({ availableCkbBalance: ccc.fixedPointFrom(100) }),
      }),
    ).toMatchObject({
      requestedTesterScenario: "auto",
      newOrders: [
        { giveCkb: "12", takeIckb: "11", fee: "1" },
        { giveIckb: "5", takeCkb: "4", fee: "1" },
      ],
      orderCount: 2,
    });
    expect(
      attemptedOrderEvidence(
        [
          {
            direction: CKB_TO_ICKB_DIRECTION,
            amount: first.amount,
            amounts: first.amounts,
          },
          {
            direction: ICKB_TO_CKB_DIRECTION,
            amount: second.amount,
            amounts: second.amounts,
          },
        ],
        [first, second],
        feePolicy,
      ),
    ).toMatchObject({
      attemptedOrders: [
        { giveCkb: "12", takeIckb: "11", fee: "1" },
        { giveIckb: "5", takeCkb: "4", fee: "1" },
      ],
      attemptedOrderCount: 2,
    });
  });
});
describe(`${PLAN_TESTER_TRANSACTION} SDK action evidence`, () => {
  it("does not claim exact SDK conversion order evidence", () => {
    const actions = testerExecutionActions({
      requestedScenario: SDK_CONVERSION_SCENARIO,
      effectiveScenario: SDK_CONVERSION_SCENARIO,
      conversion: { kind: "order" },
      conversionNotice: undefined,
      estimatedOrders: [
        estimatedOrder(
          CKB_TO_ICKB_DIRECTION,
          ccc.fixedPointFrom(12),
          ccc.fixedPointFrom(12),
          ccc.fixedPointFrom(11),
          ccc.fixedPointFrom(1),
        ),
      ],
      feePolicy: { fee: 1n, feeBase: 1000n },
      state: testerState({ availableCkbBalance: ccc.fixedPointFrom(3000) }),
    });

    expect(actions).toEqual({
      testerScenario: SDK_CONVERSION_SCENARIO,
      conversion: { kind: "order" },
      collectedOrders: 0,
      cancelledOrders: 0,
    });
  });

  it("keeps SDK conversion notices in action evidence", () => {
    const actions = testerExecutionActions({
      requestedScenario: SDK_CONVERSION_SCENARIO,
      effectiveScenario: SDK_CONVERSION_SCENARIO,
      conversion: { kind: DIRECT_PLUS_ORDER_CONVERSION },
      conversionNotice: {
        kind: "maturity-unavailable",
        inputIckb: 12n,
        outputCkb: 10n,
        incentiveCkb: 1n,
        maturityEstimateUnavailable: true,
      },
      estimatedOrders: [
        estimatedOrder(
          ICKB_TO_CKB_DIRECTION,
          ccc.fixedPointFrom(12),
          ccc.fixedPointFrom(10),
          ccc.fixedPointFrom(11),
          ccc.fixedPointFrom(1),
        ),
      ],
      feePolicy: { fee: 1n, feeBase: 1000n },
      state: testerState({ availableCkbBalance: ccc.fixedPointFrom(3000) }),
    });

    expect(actions).toEqual({
      testerScenario: SDK_CONVERSION_SCENARIO,
      conversion: { kind: DIRECT_PLUS_ORDER_CONVERSION },
      conversionNotice: {
        kind: "maturity-unavailable",
        inputIckb: 12n,
        outputCkb: 10n,
        incentiveCkb: 1n,
        maturityEstimateUnavailable: true,
      },
      collectedOrders: 0,
      cancelledOrders: 0,
    });
  });
});
describe(`${PLAN_TESTER_TRANSACTION} SDK skip evidence`, () => {
  it("reports SDK dust conversion notices as attempted skip evidence", () => {
    const skip = testerSdkConversionNoticeSkip({
      requestedScenario: "auto",
      effectiveScenario: SDK_CONVERSION_SCENARIO,
      conversion: { kind: DIRECT_PLUS_ORDER_CONVERSION },
      conversionNotice: {
        kind: DUST_ICKB_TO_CKB_NOTICE,
        inputIckb: 12n,
        outputCkb: 10n,
        incentiveCkb: 1n,
        maturityEstimateUnavailable: false,
      },
      orderEvidence: {
        attemptedOrder: {
          giveIckb: "0.00000012",
          takeCkb: "0.0000001",
          fee: ONE_SHANNON_TEXT,
          feeNumerator: "1",
          feeBase: "100000",
        },
      },
    });

    expect(skip).toEqual({
      reason: ESTIMATED_TOO_SMALL_REASON,
      requestedTesterScenario: "auto",
      testerScenario: SDK_CONVERSION_SCENARIO,
      attemptedConversion: { kind: DIRECT_PLUS_ORDER_CONVERSION },
      conversionNotice: {
        kind: DUST_ICKB_TO_CKB_NOTICE,
        inputIckb: 12n,
        outputCkb: 10n,
        incentiveCkb: 1n,
        maturityEstimateUnavailable: false,
      },
      attemptedOrder: {
        giveIckb: "0.00000012",
        takeCkb: "0.0000001",
        fee: ONE_SHANNON_TEXT,
        feeNumerator: "1",
        feeBase: "100000",
      },
    });
  });

  it("omits non-record SDK conversion notice details", () => {
    expect(
      testerSdkConversionNoticeSkip({
        requestedScenario: SDK_CONVERSION_SCENARIO,
        effectiveScenario: SDK_CONVERSION_SCENARIO,
        conversion: undefined,
        conversionNotice: undefined,
        orderEvidence: {
          attemptedOrder: { giveIckb: "1", feeNumerator: "1", feeBase: "100000" },
        },
      }),
    ).toEqual({
      reason: ESTIMATED_TOO_SMALL_REASON,
      testerScenario: SDK_CONVERSION_SCENARIO,
      attemptedOrder: { giveIckb: "1", feeNumerator: "1", feeBase: "100000" },
    });
  });
});
describe(`${PLAN_TESTER_TRANSACTION} attempted transaction evidence`, () => {
  it("uses attempted conversion evidence when a conversion was planned", () => {
    expect(
      testerAttemptedTransactionEvidence(
        SDK_CONVERSION_SCENARIO,
        SDK_CONVERSION_SCENARIO,
        { kind: DIRECT_PLUS_ORDER_CONVERSION },
        { attemptedOrder: { giveIckb: "1", feeNumerator: "1", feeBase: "100000" } },
      ),
    ).toEqual({
      testerScenario: SDK_CONVERSION_SCENARIO,
      attemptedConversion: { kind: DIRECT_PLUS_ORDER_CONVERSION },
    });
  });
});
describe(`${PLAN_TESTER_TRANSACTION} estimated skip evidence`, () => {
  it("keeps attempted order evidence available for unbuildable estimates", () => {
    const skip = testerEstimatedTooSmallSkip({
      requestedScenario: "auto",
      effectiveScenario: DUST_CKB_CONVERSION_SCENARIO,
      rawOrders: [
        {
          direction: CKB_TO_ICKB_DIRECTION,
          amount: 1n,
          amounts: { ckbValue: 1n, udtValue: 0n },
        },
      ],
      estimatedOrders: [],
      feePolicy: { fee: 1n, feeBase: 100000n },
    });

    expect(skip).toEqual({
      reason: ESTIMATED_TOO_SMALL_REASON,
      requestedTesterScenario: "auto",
      testerScenario: DUST_CKB_CONVERSION_SCENARIO,
      attemptedOrder: {
        giveCkb: ONE_SHANNON_TEXT,
        feeNumerator: "1",
        feeBase: "100000",
      },
    });
  });

  it("keeps converted attempted order evidence for zero estimates", () => {
    const skip = testerEstimatedTooSmallSkip({
      requestedScenario: DUST_ICKB_CONVERSION_SCENARIO,
      effectiveScenario: DUST_ICKB_CONVERSION_SCENARIO,
      rawOrders: [
        {
          direction: ICKB_TO_CKB_DIRECTION,
          amount: 1n,
          amounts: { ckbValue: 0n, udtValue: 1n },
        },
      ],
      estimatedOrders: [estimatedOrder(ICKB_TO_CKB_DIRECTION, 1n, 0n, 1n, 0n)],
      feePolicy: { fee: 1n, feeBase: 100000n },
    });

    expect(skip).toEqual({
      reason: ESTIMATED_TOO_SMALL_REASON,
      testerScenario: DUST_ICKB_CONVERSION_SCENARIO,
      attemptedOrder: {
        giveIckb: ONE_SHANNON_TEXT,
        takeCkb: "0",
        fee: "0",
        feeNumerator: "1",
        feeBase: "100000",
      },
    });
  });

  it("formats unestimated iCKB raw orders without converted fields", () => {
    expect(
      testerEstimatedTooSmallSkip({
        requestedScenario: DUST_ICKB_CONVERSION_SCENARIO,
        effectiveScenario: DUST_ICKB_CONVERSION_SCENARIO,
        rawOrders: [
          {
            direction: ICKB_TO_CKB_DIRECTION,
            amount: 1n,
            amounts: { ckbValue: 0n, udtValue: 1n },
          },
        ],
        estimatedOrders: [],
        feePolicy: { fee: 1n, feeBase: 100000n },
      }),
    ).toMatchObject({
      attemptedOrder: {
        giveIckb: ONE_SHANNON_TEXT,
        feeNumerator: "1",
        feeBase: "100000",
      },
    });
  });
});
