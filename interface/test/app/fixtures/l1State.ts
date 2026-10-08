import type { L1StateType } from "../../../src/app/queries.ts";
import type { TxInfo } from "../../../src/shared/utils.ts";
import { txWithInput } from "../../action/fixtures/transaction.ts";

export function activeTxInfo(): TxInfo {
  return {
    tx: txWithInput("11"),
    error: "",
    fee: 1n,
    estimatedMaturity: 0n,
    conversionKind: "order",
  };
}

export function l1State(): L1StateType {
  const candidate: unknown = {
    projection: {},
    system: { tip: { timestamp: 0n } },
    stateId: "state",
    txBuilder: async () => {
      await Promise.resolve();
      return activeTxInfo();
    },
    hasCollectable: false,
  };
  if (!isL1State(candidate)) {
    throw new Error("L1 state fixture is invalid");
  }
  return candidate;
}

function isL1State(value: unknown): value is L1StateType {
  return typeof value === "object" && value !== null && "txBuilder" in value;
}
