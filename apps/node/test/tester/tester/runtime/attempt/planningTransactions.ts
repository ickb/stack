import { describe, expect, it } from "vitest";

import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  CKB_TO_ICKB_DIRECTION,
  ESTIMATED_TOO_SMALL_REASON,
  SDK_CONVERSION_SCENARIO,
  buildBaseTransactionMock,
  ccc,
  completeTransactionMock,
  planTesterAttempt,
  requestMock,
  runtimeWithSdk,
  testerState,
} from "./support.ts";

describe("planTesterAttempt transaction building", () => {
  it("returns a completed raw-order transaction plan", async () => {
    const calls: string[] = [];
    const runtime = runtimeWithSdk({
      buildBaseTransaction: buildBaseTransactionMock(calls),
      request: requestMock(calls),
      completeTransaction: completeTransactionMock(calls),
    });
    const state = testerState({ availableCkbBalance: ccc.fixedPointFrom(4000) });

    const result = await planTesterAttempt({
      runtime,
      state,
      testerScenario: ALL_CKB_LIMIT_ORDER_SCENARIO,
      feePolicy: { fee: 1n, feeBase: 100000n },
      depositCapacity: ccc.fixedPointFrom(1000),
      totalEquivalentCkb: ccc.fixedPointFrom(3000),
      executionLog: {},
    });

    expect(result).toMatchObject({
      effectiveTesterScenario: ALL_CKB_LIMIT_ORDER_SCENARIO,
      effectiveFeePolicy: { fee: 1n, feeBase: 100000n },
      rawOrders: [
        {
          direction: CKB_TO_ICKB_DIRECTION,
          amount: ccc.fixedPointFrom(2000),
          amounts: { ckbValue: ccc.fixedPointFrom(2000), udtValue: 0n },
        },
      ],
      built: {
        conversion: undefined,
        conversionNotice: undefined,
      },
    });
    expect(calls).toEqual(["base", "request", "complete"]);
  });

  it("uses default fee policy for SDK conversion planning and skips dust notices", async () => {
    const executionLog: Record<string, unknown> = {};
    const state = testerState({
      availableCkbBalance: 0n,
      availableIckbBalance: ccc.fixedPointFrom(1),
    });
    const runtime = runtimeWithSdk({
      buildConversionTransaction: async (txLike) => {
        await Promise.resolve();
        return {
          ok: true,
          tx: ccc.Transaction.from(txLike),
          estimatedMaturity: 0n,
          conversion: { kind: "direct-plus-order" },
          conversionNotice: {
            kind: "dust-ickb-to-ckb",
            inputIckb: ccc.fixedPointFrom(1),
            outputCkb: 0n,
            incentiveCkb: 0n,
            maturityEstimateUnavailable: false,
          },
        };
      },
      completeTransaction: completeTransactionMock([]),
    });

    const result = await planTesterAttempt({
      runtime,
      state,
      testerScenario: SDK_CONVERSION_SCENARIO,
      feePolicy: { fee: 7n, feeBase: 1000n },
      depositCapacity: ccc.fixedPointFrom(1000),
      totalEquivalentCkb: ccc.fixedPointFrom(2000),
      executionLog,
    });

    expect(result).toBeUndefined();
    expect(executionLog["skip"]).toMatchObject({
      reason: ESTIMATED_TOO_SMALL_REASON,
      testerScenario: SDK_CONVERSION_SCENARIO,
      conversionNotice: { kind: "dust-ickb-to-ckb" },
      attemptedOrder: { feeNumerator: "1", feeBase: "100000" },
    });
  });
});
