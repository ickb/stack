import { ccc } from "@ckb-ccc/core";

export const CKB = ccc.fixedPointFrom(1);
export const CKB_RESERVE = 1000n * CKB;
export const POOL_MIN_LOCK_UP = ccc.Epoch.from([0n, 1n, 16n]);
export const POOL_MAX_LOCK_UP = ccc.Epoch.from([0n, 4n, 16n]);
