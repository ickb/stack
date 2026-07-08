import { ccc } from "@ckb-ccc/core";
import type { ExchangeRatio, ValueComponents } from "@ickb/utils";
import type { OrderCell } from "../model/cells.ts";
import type { MatchDiagnostics } from "./match_types.ts";
import { ceilDiv } from "./order_conversion.ts";
import { orderMatchers, summarizeMatchers } from "./order_match_sequence.ts";
import type { OrderMatcher } from "./order_matcher.ts";

export interface BestMatchOptions {
  feeRate?: ccc.Num;
  ckbAllowanceStep?: ccc.FixedPoint;
  maxPartials?: number;
}

export interface BestMatchContext {
  allowance: ValueComponents;
  ckbAllowanceStep: ccc.FixedPoint;
  ckbMiningFee: ccc.FixedPoint;
  ckbScale: bigint;
  ckbToUdtMatchers: OrderMatcher[];
  diagnostics: MatchDiagnostics;
  maxPartials?: number;
  udtAllowanceStep: ccc.FixedPoint;
  udtScale: bigint;
  udtToCkbMatchers: OrderMatcher[];
}

export function createBestMatchContext({
  orderPool,
  allowance,
  exchangeRate,
  orderSize,
  options,
}: {
  orderPool: OrderCell[];
  allowance: ValueComponents;
  exchangeRate: ExchangeRatio;
  orderSize: number;
  options: BestMatchOptions | undefined;
}): BestMatchContext {
  const { ckbScale, udtScale } = checkedExchangeRate(exchangeRate);
  const ckbAllowanceStep = checkedCkbAllowanceStep(options?.ckbAllowanceStep);
  const ckbMiningFee =
    (ccc.numFrom(36 + orderSize) * (options?.feeRate ?? 1000n) + 999n) / 1000n;
  const udtAllowanceStep = ceilDiv(ckbAllowanceStep * ckbScale, udtScale);
  const ckbToUdtMatchers = orderMatchers(orderPool, true, ckbMiningFee);
  const udtToCkbMatchers = orderMatchers(orderPool, false, ckbMiningFee);
  const diagnostics = bestMatchDiagnostics({
    allowance,
    ckbAllowanceStep,
    ckbMiningFee,
    ckbToUdtMatchers,
    maxPartials: options?.maxPartials,
    orderCount: orderPool.length,
    udtAllowanceStep,
    udtToCkbMatchers,
  });

  return {
    allowance,
    ckbAllowanceStep,
    ckbMiningFee,
    ckbScale,
    ckbToUdtMatchers,
    diagnostics,
    ...(options?.maxPartials === undefined ? {} : { maxPartials: options.maxPartials }),
    udtAllowanceStep,
    udtScale,
    udtToCkbMatchers,
  };
}

function checkedExchangeRate(exchangeRate: ExchangeRatio): {
  ckbScale: bigint;
  udtScale: bigint;
} {
  const { ckbScale, udtScale } = exchangeRate;
  if (ckbScale <= 0n || udtScale <= 0n) {
    throw new Error("Exchange rate scales must be positive");
  }
  return { ckbScale, udtScale };
}

function checkedCkbAllowanceStep(value?: ccc.FixedPoint): ccc.FixedPoint {
  const ckbAllowanceStep = value ?? ccc.fixedPointFrom("1000");
  if (ckbAllowanceStep <= 0n) {
    throw new Error("CKB allowance step must be positive");
  }
  return ckbAllowanceStep;
}

function bestMatchDiagnostics(options: {
  allowance: ValueComponents;
  ckbAllowanceStep: ccc.FixedPoint;
  ckbMiningFee: ccc.FixedPoint;
  ckbToUdtMatchers: OrderMatcher[];
  maxPartials?: number;
  orderCount: number;
  udtAllowanceStep: ccc.FixedPoint;
  udtToCkbMatchers: OrderMatcher[];
}): MatchDiagnostics {
  return {
    orderCount: options.orderCount,
    allowance: options.allowance,
    ckbAllowanceStep: options.ckbAllowanceStep,
    udtAllowanceStep: options.udtAllowanceStep,
    ckbMiningFee: options.ckbMiningFee,
    ...(options.maxPartials === undefined ? {} : { maxPartials: options.maxPartials }),
    directions: {
      ckbToUdt: summarizeMatchers(options.ckbToUdtMatchers),
      udtToCkb: summarizeMatchers(options.udtToCkbMatchers),
    },
    candidates: {
      total: 0,
      viable: 0,
      positiveGain: 0,
      rejected: {
        maxPartials: 0,
        duplicateOrder: 0,
        insufficientCkbAllowance: 0,
        insufficientUdtAllowance: 0,
        nonPositiveGain: 0,
      },
      bestGain: 0n,
    },
  };
}
