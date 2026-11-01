import type { L1StateType } from "../../../src/app/queries.ts";
import { activeTxInfo } from "../../action/fixtures/transaction.ts";

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
    hasConverting: false,
  };
  if (!isL1State(candidate)) {
    throw new Error("L1 state fixture is invalid");
  }
  return candidate;
}

function isL1State(value: unknown): value is L1StateType {
  return typeof value === "object" && value !== null && "txBuilder" in value;
}
