import type { AccountAvailabilityProjection } from "@ickb/sdk";

/** A projection with the six displayed figures set and nothing pending beyond them. */
export function projection(
  amounts: Pick<
    AccountAvailabilityProjection,
    | "ckbNative"
    | "ickbNative"
    | "ckbAvailable"
    | "ickbAvailable"
    | "ckbBalance"
    | "ickbBalance"
  >,
): AccountAvailabilityProjection {
  return {
    ...amounts,
    ckbPending: amounts.ckbBalance - amounts.ckbNative,
    ickbPending: amounts.ickbBalance - amounts.ickbNative,
    readyWithdrawals: [],
    pendingWithdrawals: [],
    availableOrders: [],
    pendingOrders: [],
  };
}
