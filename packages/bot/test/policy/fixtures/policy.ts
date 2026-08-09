import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP, type IckbDepositCell } from "@ickb/core";
import { headerLike } from "@ickb/testkit";
import {
  CKB,
  CKB_RESERVE,
  planRebalance as planRebalanceImpl,
} from "../../../src/policy.ts";

export { CKB, CKB_RESERVE, ICKB_DEPOSIT_CAP };

export const TARGET_ICKB_BALANCE = ICKB_DEPOSIT_CAP + 20000n * CKB;
const READY_WINDOW_END_MS = 16n;
export const RING_LENGTH_EPOCHS = 180n;
export const PLAN_REBALANCE_SUITE = "planRebalance";
export const TIP = headerLike({ epoch: [0n, 0n, 1n], timestamp: 0n });
export const NO_POOL_REST: IckbDepositCell[] = [];

let nextDepositKey = 0;

export function readyDeposit(
  udtValue: bigint,
  maturityUnix: bigint,
  key = `ready-${String(nextDepositKey++)}`,
): IckbDepositCell {
  const minute = 60n * 1000n;
  const ringEpoch = maturityUnix % minute === 0n ? maturityUnix / minute : maturityUnix;
  return depositCell({
    key,
    isReady: true,
    udtValue,
    maturity: new TestEpoch(ringEpoch, 0n, 1n, maturityUnix),
  });
}

export function futureDeposit(
  maturityUnix: bigint,
  udtValue = ICKB_DEPOSIT_CAP,
  options?: { isReady?: boolean; key?: string },
): IckbDepositCell {
  const minute = 60n * 1000n;
  const scaledEpoch =
    maturityUnix < minute
      ? maturityUnix * RING_LENGTH_EPOCHS
      : (maturityUnix / minute) * READY_WINDOW_END_MS;
  const denominator = maturityUnix < minute ? READY_WINDOW_END_MS : 1n;
  return depositCell({
    key: options?.key ?? `future-${String(nextDepositKey++)}`,
    udtValue,
    maturity: new TestEpoch(
      scaledEpoch / denominator,
      scaledEpoch % denominator,
      denominator,
      maturityUnix,
    ),
    isReady: options?.isReady ?? false,
  });
}

type PlanRebalanceOptions = Parameters<typeof planRebalanceImpl>[0];
type TestPlanRebalanceOptions = Omit<
  PlanRebalanceOptions,
  "poolDeposits" | "directDepositCapacity"
> & {
  depositCapacity: bigint;
  directDepositCapacity?: bigint;
  poolDepositsRest: PlanRebalanceOptions["poolDeposits"];
  poolDepositsNearReady?: PlanRebalanceOptions["poolDeposits"];
  poolDeposits?: PlanRebalanceOptions["poolDeposits"];
};

export function planRebalance(
  options: TestPlanRebalanceOptions,
): ReturnType<typeof planRebalanceImpl> {
  const {
    depositCapacity,
    poolDepositsRest,
    poolDepositsNearReady = [],
    poolDeposits,
    ...rebalanceOptions
  } = options;
  return planRebalanceImpl({
    ...rebalanceOptions,
    directDepositCapacity: options.directDepositCapacity ?? depositCapacity,
    poolDeposits: poolDeposits ?? [
      ...options.readyDeposits,
      ...poolDepositsNearReady,
      ...poolDepositsRest,
    ],
  });
}

function depositCell(options: {
  key: string;
  udtValue: bigint;
  maturity: ccc.Epoch;
  isReady: boolean;
}): IckbDepositCell {
  const deposit: TestDepositCell = {
    cell: { outPoint: { toHex: (): string => options.key } },
    isReady: options.isReady,
    maturity: options.maturity,
    ckbValue: options.udtValue,
    udtValue: options.udtValue,
  };
  if (isDepositFixture(deposit)) {
    return deposit;
  }
  throw new Error("Invalid deposit fixture");
}

class TestEpoch extends ccc.Epoch {
  public readonly unix: bigint;

  constructor(integer: bigint, numerator: bigint, denominator: bigint, unix: bigint) {
    super(integer, numerator, denominator);
    this.unix = unix;
  }

  public override add(epoch: ccc.EpochLike): ccc.Epoch {
    const added = super.add(epoch);
    return new TestEpoch(
      added.integer,
      added.numerator,
      added.denominator,
      READY_WINDOW_END_MS,
    );
  }

  public override toUnix(): bigint {
    return this.unix;
  }
}

interface TestDepositCell {
  cell: { outPoint: { toHex: () => string } };
  isReady: boolean;
  maturity: ccc.Epoch;
  ckbValue: bigint;
  udtValue: bigint;
}

function isDepositFixture(value: TestDepositCell): value is IckbDepositCell {
  return typeof value.cell.outPoint.toHex() === "string";
}
