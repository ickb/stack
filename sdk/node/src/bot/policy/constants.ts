import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP } from "../../../../src/core/index.ts";

export const CKB = ccc.fixedPointFrom(1);
/** Plain CKB every match and deposit leaves behind for markers and fees. */
export const CKB_RESERVE = 1000n * CKB;
export const POOL_MIN_LOCK_UP = ccc.Epoch.from([0n, 1n, 16n]);
export const POOL_MAX_LOCK_UP = ccc.Epoch.from([0n, 4n, 16n]);

// The inventory band the pre-rewrite bot ran for a year: refill under 2,000 iCKB,
// withdraw above 120,000 keeping 20,000, so a refill lands far below the withdrawal
// line and a withdrawal keeps ten times the refill line (decisions amendment 52).
export const ICKB_REFILL_BELOW = ICKB_DEPOSIT_CAP / 50n;
export const ICKB_RETAIN = ICKB_DEPOSIT_CAP / 5n;
export const ICKB_WITHDRAW_ABOVE = ICKB_DEPOSIT_CAP + ICKB_RETAIN;
/** Anchors may be withdrawn only when spendable CKB is below this fraction of a deposit. */
export const STRESS_DIVISOR = 5n;
