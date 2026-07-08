import type { ccc } from "@ckb-ccc/core";
import type { ValueComponents } from "@ickb/utils";
import type { OrderCell } from "../model/cells.ts";

/**
 * Result of matching one or more orders against available allowance.
 *
 * @public
 */
export interface Match {
  /** Net CKB change from the match from the matcher caller's perspective. */
  ckbDelta: bigint;

  /** Net UDT change from the match from the matcher caller's perspective. */
  udtDelta: bigint;

  /** Partial order outputs that must replace matched order inputs. */
  partials: Array<{
    /** Matched input order. */
    order: OrderCell;

    /** CKB capacity for the replacement partial order output. */
    ckbOut: ccc.FixedPoint;

    /** UDT amount for the replacement partial order output. */
    udtOut: ccc.FixedPoint;
  }>;

  /** Optional diagnostics produced by best-match search. */
  diagnostics?: MatchDiagnostics;
}

/**
 * Search diagnostics for best-match selection.
 *
 * @public
 */
export interface MatchDiagnostics {
  /** Number of orders inspected. */
  orderCount: number;
  /** Original match allowance. */
  allowance: ValueComponents;
  /** CKB allowance step used during search. */
  ckbAllowanceStep: ccc.FixedPoint;
  /** UDT allowance step derived from the exchange rate. */
  udtAllowanceStep: ccc.FixedPoint;
  /** CKB fee budget reserved per matched order. */
  ckbMiningFee: ccc.FixedPoint;
  /** Optional maximum number of partial order outputs. */
  maxPartials?: number;
  /** Per-direction matchability bounds. */
  directions: {
    ckbToUdt: MatchDirectionDiagnostics;
    udtToCkb: MatchDirectionDiagnostics;
  };
  /** Candidate counts and rejection reasons from the search. */
  candidates: {
    total: number;
    viable: number;
    positiveGain: number;
    rejected: {
      maxPartials: number;
      duplicateOrder: number;
      insufficientCkbAllowance: number;
      insufficientUdtAllowance: number;
      nonPositiveGain: number;
    };
    bestGain: bigint;
  };
}

/**
 * Matchability bounds for one order direction.
 *
 * @public
 */
export interface MatchDirectionDiagnostics {
  /** Number of orders matchable in this direction. */
  matchableCount: number;
  /** Smallest required allowance among matchable orders. */
  minAllowance?: ccc.FixedPoint;
  /** Largest possible match amount among matchable orders. */
  maxMatch?: ccc.FixedPoint;
}
