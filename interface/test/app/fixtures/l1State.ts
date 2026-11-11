import type { L1StateType } from "../../../src/app/queries.ts";
import type { TxInfo, WalletConfig } from "../../../src/shared/utils.ts";
import { activeTxInfo, state } from "../../action/fixtures/transaction.ts";

export function l1State(): L1StateType {
  return {
    ...state(),
    stateId: "state",
    txBuilder: async (): Promise<TxInfo> => {
      await Promise.resolve();
      return activeTxInfo();
    },
    hasConverting: false,
  };
}

/** Narrows a partial test double to a wallet config by the fields the action reads. */
export function isWalletConfig(value: unknown): value is WalletConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "queryClient" in value &&
    "signer" in value
  );
}
