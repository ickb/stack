import type { State } from "@ickb/sdk";
import { state } from "../../action/fixtures/transaction.ts";

/** A state with the six displayed figures set; each Max is the available amount. */
export function balanceState(
  amounts: Pick<
    State,
    | "ckbNative"
    | "ickbNative"
    | "ckbAvailable"
    | "ickbAvailable"
    | "ckbBalance"
    | "ickbBalance"
  >,
): State {
  return state({
    ...amounts,
    ckbConvertible: amounts.ckbAvailable,
    ickbConvertible: amounts.ickbAvailable,
  });
}
