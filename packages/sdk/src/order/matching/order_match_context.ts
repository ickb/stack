import { ccc } from "@ckb-ccc/core";
import type { ExchangeRatio, ValueComponents } from "../../utils/index.ts";
import type { OrderGroup } from "../model/cells.ts";
import type { MatchDiagnostics } from "./match_types.ts";
import { ceilDiv } from "./order_conversion.ts";
import { orderMatchers, summarizeMatchers } from "./order_match_sequence.ts";
import type { OrderMatcher } from "./order_matcher.ts";

const CELL_INPUT_SERIALIZED_SIZE = 44;
// CellOutput table/script wrappers plus DynVec offset; output data Bytes plus offset.
const CELL_OUTPUT_SERIALIZATION_OVERHEAD = 60;
const OUTPUT_DATA_SERIALIZATION_OVERHEAD = 8;
// The supported SDK completion prepares a later signer witness, inserting one
// empty witness-vector entry for each preceding order input.
const EMPTY_WITNESS_SERIALIZATION_SIZE = 8;
const PREPARED_PARTIAL_SERIALIZATION_OVERHEAD =
  CELL_INPUT_SERIALIZED_SIZE +
  CELL_OUTPUT_SERIALIZATION_OVERHEAD +
  OUTPUT_DATA_SERIALIZATION_OVERHEAD +
  EMPTY_WITNESS_SERIALIZATION_SIZE;
const DEFAULT_CANDIDATE_BUDGET = 100_000;

/** Options controlling bounded best-match search. @public */
export interface BestMatchOptions {
  /** Fee rate in shannons per 1,000 prepared transaction bytes. */
  feeRate?: ccc.Num;
  /** CKB step used by the deterministic fallback probe grid. */
  ckbAllowanceStep?: ccc.FixedPoint;
  /** Maximum number of partial order outputs. */
  maxPartials?: number;
  /** Maximum probe, expansion, and candidate work before returning incomplete. */
  candidateBudget?: number;
}

export interface BestMatchContext {
  allowance: ValueComponents;
  candidateBudget: number;
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
  orderPool: OrderGroup[];
  allowance: ValueComponents;
  exchangeRate: ExchangeRatio;
  orderSize: number;
  options: BestMatchOptions | undefined;
}): BestMatchContext {
  const { ckbScale, udtScale } = checkedExchangeRate(exchangeRate);
  const candidateBudget = checkedCandidateBudget(options?.candidateBudget);
  const ckbAllowanceStep = checkedCkbAllowanceStep(options?.ckbAllowanceStep);
  const feeRate = checkedFeeRate(options?.feeRate);
  const maxPartials = checkedMaxPartials(options?.maxPartials);
  const ckbMiningFee =
    (preparedPartialOrderSerializedSize(orderSize) * feeRate + 999n) / 1000n;
  const udtAllowanceStep = ceilDiv(ckbAllowanceStep * ckbScale, udtScale);
  const ckbToUdtMatchers = orderMatchers(orderPool, true, ckbMiningFee);
  const udtToCkbMatchers = orderMatchers(orderPool, false, ckbMiningFee);
  const diagnostics = bestMatchDiagnostics({
    allowance,
    candidateBudget,
    ckbAllowanceStep,
    ckbMiningFee,
    ckbToUdtMatchers,
    maxPartials,
    orderCount: orderPool.length,
    udtAllowanceStep,
    udtToCkbMatchers,
  });

  return {
    allowance,
    candidateBudget,
    ckbAllowanceStep,
    ckbMiningFee,
    ckbScale,
    ckbToUdtMatchers,
    diagnostics,
    ...(maxPartials === undefined ? {} : { maxPartials }),
    udtAllowanceStep,
    udtScale,
    udtToCkbMatchers,
  };
}

function checkedFeeRate(feeRate: ccc.Num = 1000n): ccc.Num {
  if (feeRate < 0n) {
    throw new Error("Fee rate must be non-negative");
  }
  return feeRate;
}

function checkedCandidateBudget(
  candidateBudget: number = DEFAULT_CANDIDATE_BUDGET,
): number {
  if (!Number.isSafeInteger(candidateBudget) || candidateBudget <= 0) {
    throw new Error("Candidate budget must be a positive safe integer");
  }
  return candidateBudget;
}

function checkedMaxPartials(maxPartials?: number): number | undefined {
  if (
    maxPartials !== undefined &&
    (!Number.isSafeInteger(maxPartials) || maxPartials < 0)
  ) {
    throw new Error("Maximum partials must be a non-negative safe integer");
  }
  return maxPartials;
}

export function preparedPartialOrderSerializedSize(orderOccupiedSize: number): bigint {
  return ccc.numFrom(orderOccupiedSize + PREPARED_PARTIAL_SERIALIZATION_OVERHEAD);
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
  candidateBudget: number;
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
    candidateBudget: options.candidateBudget,
    workCount: 0,
    ckbAllowanceStep: options.ckbAllowanceStep,
    udtAllowanceStep: options.udtAllowanceStep,
    ckbMiningFee: options.ckbMiningFee,
    ...(options.maxPartials === undefined ? {} : { maxPartials: options.maxPartials }),
    generatedStates: { ckbToUdt: 0, udtToCkb: 0 },
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
