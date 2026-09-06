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

/** Search mode used to produce an order match result. @public */
export type MatchSearchMode = "atomic" | "stepped";

/** Bounded search phase that stopped before all scheduled work completed. @public */
export type MatchSearchPhase =
  "preflight" | "ckbToUdtFrontier" | "udtToCkbFrontier" | "candidates";

/** Result of bounded best-match search. @public */
export type MatchSearchResult =
  | {
      /** Full atomic feasible domain was covered and the optimum is proven. */
      kind: "complete";
      /** Proven globally optimal match. */
      match: Match;
    }
  | {
      /** Search covered only a deterministic subset of the atomic domain. */
      kind: "incomplete";
      /** Best economically exact match among visited probes. */
      match: Match;
      /** Why the atomic optimum could not be certified. */
      reason: "atomic_domain_exceeds_budget" | "candidate_budget_exhausted";
      /** Probe schedule used before returning. */
      searchMode: MatchSearchMode;
      /** Configured work-unit limit. */
      budget: number;
      /** Work units consumed by visited probes, expansions, and candidates. */
      work: number;
      /** Boundary proving that scheduled work remained uncovered. */
      truncation: {
        /** Search phase that could not be certified or completed. */
        phase: MatchSearchPhase;
        /** Work required to cross the reported boundary. */
        requiredWork: bigint;
      };
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
  /** CKB allowance step used during search. */
  ckbAllowanceStep: ccc.FixedPoint;
  /** UDT allowance step derived from the exchange rate. */
  udtAllowanceStep: ccc.FixedPoint;
  /** CKB fee budget reserved per matched order. */
  ckbMiningFee: ccc.FixedPoint;
  /** Maximum total search work across frontier and candidate-phase owners. */
  candidateBudget: number;
  /**
   * Total consumed work units. Frontier phases own allowance probes and prior-state
   * inspections; an inspection includes any resulting allocation and evaluation.
   * The candidate phase owns the initial evaluation, cross-pair inspections, and
   * residual matcher attempts.
   */
  workCount: number;
  /** Optional maximum number of partial order outputs. */
  maxPartials?: number;
  /** Number of retained states generated in each direction. */
  generatedStates: {
    ckbToUdt: number;
    udtToCkb: number;
  };
  /** Per-direction matchability bounds. */
  directions: {
    ckbToUdt: MatchDirectionDiagnostics;
    udtToCkb: MatchDirectionDiagnostics;
  };
  /** Candidate-phase work and rejection diagnostics from the search. */
  candidates: {
    /**
     * Consumed candidate-phase units. The initial evaluation and each cross-pair
     * inspection or residual matcher attempt increment this exactly once, including
     * attempts filtered before economic evaluation. Directional evaluations belong
     * to their frontier state-inspection units instead.
     */
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
