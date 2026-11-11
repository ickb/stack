import type { L1StateType } from "../../../src/app/queries.ts";
import type { TxInfo } from "../../../src/shared/utils.ts";
import { activeTxInfo, state } from "../../action/fixtures/transaction.ts";

export function l1State(): L1StateType {
  return {
    ...state(),
    stateId: "state",
    txBuilder: async (): Promise<TxInfo> => {
      await Promise.resolve();
      return activeTxInfo();
    },
    hasCollectable: false,
    hasConverting: false,
  };
}
