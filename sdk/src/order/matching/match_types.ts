import type { ccc } from "@ckb-ccc/core";
import type { OrderGroup } from "../model/cells.ts";

/**
 * The fills of one or more orders from the matcher caller's perspective.
 */
export interface Match {
  /** Net CKB change from the match. */
  ckbDelta: bigint;

  /** Net UDT change from the match. */
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
}
