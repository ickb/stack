import { ccc } from "@ckb-ccc/core";
import type { IckbSdk } from "@ickb/sdk";
import type { TesterDirection } from "../../testerContract.ts";
export {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  AUTO_TESTER_SCENARIOS,
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  CKB_TO_ICKB,
  DEFAULT_TESTER_FEE_POLICY,
  DUST_CKB_CONVERSION_SCENARIO,
  DUST_ICKB_CONVERSION_SCENARIO,
  EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
  ICKB_TO_CKB,
  ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  isTesterScenarioSelection,
  MAX_TESTER_FEE_BASE,
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
  MULTI_ORDER_SCENARIOS,
  RANDOM_ORDER_SCENARIO,
  SDK_CONVERSION_SCENARIO,
  TESTER_SCENARIOS,
  TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
  TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
  type TesterDirection,
  type TesterFeePolicy,
  type TesterScenario,
  type TesterScenarioSelection,
} from "../../testerContract.ts";

const CKB = ccc.fixedPointFrom(1);
export const CKB_RESERVE = 1000n * CKB;
export const CKB_SPENDING_ORDER_OVERHEAD = 1000n * CKB;
export const MIN_TOTAL_CAPITAL_DIVISOR = 20n;
export const RANDOM_SCALE = 1000000n;
export const ESTIMATED_CONVERSION_TOO_SMALL = "estimated-conversion-too-small";
/** Human-readable log fields for one planned raw order. */
export interface PlannedOrderLog {
  giveCkb?: string;
  takeIckb?: string;
  giveIckb?: string;
  takeCkb?: string;
  fee?: string;
  feeNumerator: string;
  feeBase: string;
}
/** Normalized tester plan before it is converted into raw orders or SDK conversion. */
export interface TesterPlan {
  /** Scenario direction. */
  direction: TesterDirection;

  /** Source-asset amount requested by the scenario. */
  amount: bigint;

  /** CKB amount involved in the plan. */
  ckbAmount: bigint;

  /** iCKB amount involved in the plan. */
  udtAmount: bigint;

  /** Number of raw orders requested by the plan. */
  orderCount: number;
}

/** One raw order before order info is estimated. */
export interface PlannedRawOrder {
  direction: TesterDirection;
  amounts: { ckbValue: bigint; udtValue: bigint };
  amount: bigint;
}

/** Raw order with a computed SDK estimate. */
export type EstimatedRawOrder = PlannedRawOrder & {
  estimate: ReturnType<typeof IckbSdk.estimate>;
};

export type TesterExecutionActions = Record<string, unknown>;

/** Mutable JSON log record for one tester attempt. */
export type ExecutionLog = Record<string, unknown> & {
  startTime?: string;
  skip?: unknown;
  balance?: unknown;
  ratio?: unknown;
  error?: unknown;
  actions?: unknown;
  transactionShape?: unknown;
  txFee?: unknown;
  txHash?: unknown;
};
/** Writer that owns mutation of one tester execution log record. */
export interface ExecutionLogWriter {
  record: (fields: Partial<ExecutionLog>) => void;
}
export function createExecutionLogWriter(executionLog: ExecutionLog): ExecutionLogWriter {
  return {
    record(fields): void {
      Object.assign(executionLog, fields);
    },
  };
}
/** Terminal tester error that should stop retry loops. */
export class TesterTerminalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TesterTerminalError";
  }
}
