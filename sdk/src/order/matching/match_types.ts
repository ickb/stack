import type { ccc } from "@ckb-ccc/core";
import type { ValueComponents } from "../../utils/index.ts";
import type { OrderGroup } from "../model/cells.ts";

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
    /** Resolved group that proves the matched order's mint origin. */
    group: OrderGroup;

    /** CKB capacity for the replacement partial order output. */
    ckbOut: ccc.FixedPoint;

    /** UDT amount for the replacement partial order output. */
    udtOut: ccc.FixedPoint;
  }>;

  /** Optional diagnostics produced by best-match search. */
  diagnostics?: MatchDiagnostics;
}

/** Result of the bounded best-match search. @public */
export type MatchSearchResult =
  | {
      /** Every branch was visited or pruned: the match is the best of the search space. */
      kind: "complete";
      match: Match;
    }
  | {
      /** The work budget ended the search; the match is the best feasible one visited. */
      kind: "incomplete";
      match: Match;
      /** Configured node budget. */
      budget: number;
      /** Nodes visited. */
      work: number;
      /** How much more gain an unvisited branch could at most have reached. */
      gap: bigint;
    };

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
  /** CKB fee budget reserved per matched order. */
  ckbMiningFee: ccc.FixedPoint;
  /** Maximum number of search nodes. */
  candidateBudget: number;
  /** Search nodes visited. */
  workCount: number;
  /** Optional maximum number of partial order outputs. */
  maxPartials?: number;
  /** Per-direction matchability bounds. */
  directions: {
    ckbToUdt: MatchDirectionDiagnostics;
    udtToCkb: MatchDirectionDiagnostics;
  };
  /** Gain of the returned match at the exchange ratio, net of fees. */
  bestGain: bigint;
  /** Largest gain any unvisited branch could still reach; equals `bestGain` when complete. */
  gainUpperBound: bigint;
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
