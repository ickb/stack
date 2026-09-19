import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP } from "../../../../src/core/index.ts";

export const POOL_MIN_LOCK_UP = ccc.Epoch.from([0n, 1n, 16n]);
export const POOL_MAX_LOCK_UP = ccc.Epoch.from([0n, 4n, 16n]);

// The inventory band the pre-rewrite bot ran for a year: refill under 2,000 iCKB,
// withdraw above 120,000 keeping 20,000, so a refill lands far below the withdrawal
// line and a withdrawal keeps ten times the refill line (decisions amendment 52).
// The refill line must stay above the whole-only band of `Info.ckbMinMatchLogDefault()`
// (about 1,150 iCKB at 36), so a buyer the bot cannot complete always fires a refill.
export const ICKB_REFILL_BELOW = ICKB_DEPOSIT_CAP / 50n;
export const ICKB_RETAIN = ICKB_DEPOSIT_CAP / 5n;
export const ICKB_WITHDRAW_ABOVE = ICKB_DEPOSIT_CAP + ICKB_RETAIN;
/** Anchors may be withdrawn only when spendable CKB is below this fraction of a deposit. */
export const STRESS_DIVISOR = 5n;
