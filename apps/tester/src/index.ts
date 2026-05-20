import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP, convert } from "@ickb/core";
import { IckbSdk, getConfig, sendAndWaitForCommit } from "@ickb/sdk";
import {
  createPublicClient,
  formatCkb,
  handleLoopError,
  logExecution,
  randomSleepIntervalMs,
  readRuntimeConfigEnv,
  reachedMaxIterations,
  signerAccountLocks,
  sleep,
  type RuntimeConfig,
  verifyChainPreflight,
} from "@ickb/node-utils";
import { pathToFileURL } from "node:url";
import {
  buildRawOrderTransaction,
  buildSdkConversionTransaction,
  buildTransaction,
  readTesterState,
  type Runtime,
  type RawOrderRequest,
  type TesterState,
} from "./runtime.js";
import { freshMatchableOrderSkip } from "./freshMatchableOrderSkip.js";
const CKB = ccc.fixedPointFrom(1);
const CKB_RESERVE = 2000n * CKB;
const ALL_CKB_LIMIT_ORDER_OVERHEAD = 500n * CKB;
const MIN_TOTAL_CAPITAL_DIVISOR = 20n;
const TESTER_FEE = 1n;
const TESTER_FEE_BASE = 100000n;
const MAX_TESTER_FEE_BASE = 1000000n;
const RANDOM_SCALE = 1000000n;
const TESTER_SCENARIOS = [
  "random-order",
  "sdk-conversion",
  "extra-large-limit-order",
  "multi-order-limit-orders",
  "two-ckb-to-ickb-limit-orders",
  "all-ckb-limit-order",
  "all-ickb-limit-order",
  "ickb-to-ckb-limit-order",
  "two-ickb-to-ckb-limit-orders",
  "mixed-direction-limit-orders",
  "dust-ckb-conversion",
  "dust-ickb-conversion",
] as const;
export type TesterScenario = typeof TESTER_SCENARIOS[number];
const MULTI_ORDER_SCENARIOS: TesterScenario[] = [
  "mixed-direction-limit-orders",
  "two-ckb-to-ickb-limit-orders",
  "two-ickb-to-ckb-limit-orders",
];
type TesterDirection = "ckb-to-ickb" | "ickb-to-ckb";
export type TesterFeePolicy = {
  fee: bigint;
  feeBase: bigint;
};
const DEFAULT_TESTER_FEE_POLICY: TesterFeePolicy = {
  fee: TESTER_FEE,
  feeBase: TESTER_FEE_BASE,
};
type PlannedOrderLog = {
  giveCkb?: string;
  takeIckb?: string;
  giveIckb?: string;
  takeCkb?: string;
  fee: string;
  feeNumerator: string;
  feeBase: string;
};
type TesterPlan = {
  direction: TesterDirection;
  amount: bigint;
  ckbAmount: bigint;
  udtAmount: bigint;
  orderCount: number;
};
type PlannedRawOrder = {
  direction: TesterDirection;
  amounts: { ckbValue: bigint; udtValue: bigint };
  amount: bigint;
};
type EstimatedRawOrder = PlannedRawOrder & {
  estimate: ReturnType<typeof IckbSdk.estimate>;
};

export class TesterTerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TesterTerminalError";
  }
}

async function main(): Promise<void> {
  const { chain, privateKey, rpcUrl, sleepIntervalMs, maxIterations } =
    await readTesterRuntimeConfig(process.env);
  const testerScenario = readTesterScenario(process.env);
  const feePolicy = readTesterFeePolicy(process.env);
  const secrets = { privateKey, rpcUrl };
  const client = createPublicClient(chain, rpcUrl);
  await verifyChainPreflight(client, chain);
  const config = getConfig(chain);
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  const recommendedAddress = await signer.getRecommendedAddressObj();
  const primaryLock = recommendedAddress.script;
  const runtime: Runtime = {
    client,
    signer,
    sdk: IckbSdk.fromConfig(config),
    primaryLock,
    accountLocks: await signerAccountLocks(signer, primaryLock),
  };

  let stopAfterLog = false;
  let completedIterations = 0;
  for (;;) {
    await sleep(randomSleepIntervalMs(sleepIntervalMs));

    const executionLog: Record<string, unknown> = {};
    const startTime = new Date();
    executionLog.startTime = startTime.toLocaleString();

    try {
      const state = await readTesterState(runtime);
      const skip = await freshMatchableOrderSkip(
        runtime,
        state.userOrders,
        state.system.tip,
      );
      if (skip) {
        executionLog.skip = skip;
        if (logTerminalIteration(executionLog, startTime, ++completedIterations, maxIterations)) {
          return;
        }
        continue;
      }

      const depositCapacity = convert(false, ICKB_DEPOSIT_CAP, state.system.exchangeRatio);
      const totalEquivalentCkb =
        state.availableCkbBalance +
        convert(false, state.availableIckbBalance, state.system.exchangeRatio);

      executionLog.balance = {
        CKB: {
          total: formatCkb(state.availableCkbBalance),
          available: formatCkb(state.availableCkbBalance),
          unavailable: formatCkb(0n),
        },
        ICKB: {
          total: formatCkb(state.availableIckbBalance),
          available: formatCkb(state.availableIckbBalance),
          unavailable: formatCkb(0n),
        },
        totalEquivalent: {
          CKB: formatCkb(totalEquivalentCkb),
          ICKB: formatCkb(
            convert(true, state.availableCkbBalance, state.system.exchangeRatio) +
              state.availableIckbBalance,
          ),
        },
      };
      executionLog.ratio = state.system.exchangeRatio;

      const effectiveTesterScenario = resolveTesterScenario(state, testerScenario, feePolicy);
      const plan = planTesterTransaction(state, depositCapacity, effectiveTesterScenario);
      const rawOrders = plannedRawOrders(plan, effectiveTesterScenario);

      if (rawOrders.length === 0) {
        if (totalEquivalentCkb < depositCapacity / MIN_TOTAL_CAPITAL_DIVISOR) {
          executionLog.error =
            "Not enough funds to continue testing, shutting down...";
          logExecution(executionLog, startTime);
          return;
        }
        executionLog.skip = { reason: "sampled-amount-too-small" };
        if (logTerminalIteration(executionLog, startTime, ++completedIterations, maxIterations)) {
          return;
        }
        continue;
      }

      const effectiveFeePolicy = isSdkConversionScenario(effectiveTesterScenario)
        ? DEFAULT_TESTER_FEE_POLICY
        : feePolicy;
      const estimatedOrders = rawOrders.map((order) => ({
        ...order,
        estimate: IckbSdk.estimate(order.direction === "ckb-to-ickb", order.amounts, state.system, {
          fee: effectiveFeePolicy.fee,
          feeBase: effectiveFeePolicy.feeBase,
        }),
      }));
      if (estimatedOrders.some((order) => order.estimate.convertedAmount <= 0n)) {
        executionLog.skip = { reason: "estimated-conversion-too-small" };
        if (logTerminalIteration(executionLog, startTime, ++completedIterations, maxIterations)) {
          return;
        }
        continue;
      }

      const built = isSdkConversionScenario(effectiveTesterScenario)
        ? await buildSdkConversionTransaction(runtime, state, plan.direction, plan.amount)
        : {
            tx: await buildPlannedRawOrderTransaction(runtime, state, estimatedOrders),
            conversion: undefined,
          };
      const { tx } = built;
      const txFee = tx.estimateFee(state.system.feeRate);

      if (estimatedOrders.some((order) => order.direction === "ckb-to-ickb")) {
        const postTxCkbBalance = postTransactionPlainCkbBalance(tx, state, runtime.accountLocks);
        if (postTxCkbBalance < CKB_RESERVE) {
          if (isExplicitCkbReserveScenario(effectiveTesterScenario)) {
            throw new TesterTerminalError(
              `Not enough CKB to preserve tester reserve after the tx: expected ${formatCkb(CKB_RESERVE)} CKB, got ${formatCkb(postTxCkbBalance)} CKB`,
            );
          }
          executionLog.skip = {
            reason: "post-tx-ckb-reserve",
            reserve: formatCkb(CKB_RESERVE),
            postTxCkbBalance: formatCkb(postTxCkbBalance),
          };
          if (logTerminalIteration(executionLog, startTime, ++completedIterations, maxIterations)) {
            return;
          }
          continue;
        }
      }

      executionLog.actions = {
        ...(effectiveTesterScenario === testerScenario ? {} : { requestedTesterScenario: testerScenario }),
        testerScenario: effectiveTesterScenario,
        ...(built.conversion === undefined ? {} : { conversion: built.conversion }),
        ...(built.conversion?.kind === "direct" || built.conversion?.kind === "collect-only"
          ? {}
          : orderEvidence(estimatedOrders, effectiveFeePolicy)),
        cancelledOrders: state.userOrders.filter((group) => group.order.isMatchable())
          .length,
      };
      executionLog.txFee = {
        fee: formatCkb(txFee),
        feeRate: state.system.feeRate,
      };
      executionLog.txHash = await sendAndWaitForCommit(runtime, tx, {
        onSent: (txHash) => {
          executionLog.txHash = txHash;
        },
      });
    } catch (e) {
      stopAfterLog = handleLoopError(executionLog, e, secrets);
      if (e instanceof TesterTerminalError) {
        process.exitCode = 1;
        stopAfterLog = true;
      } else if (isRetryableTesterError(e)) {
        logExecution(executionLog, startTime);
        continue;
      }
    }
    if (stopAfterLog) {
      logExecution(executionLog, startTime);
      return;
    }
    if (logTerminalIteration(executionLog, startTime, ++completedIterations, maxIterations)) {
      return;
    }
  }
}

function logTerminalIteration(
  executionLog: Record<string, unknown>,
  startTime: Date,
  completedIterations: number,
  maxIterations: number | undefined,
): boolean {
  logExecution(executionLog, startTime);
  return reachedMaxIterations(completedIterations, maxIterations);
}

function orderLog(
  isCkb2Udt: boolean,
  ckbAmount: bigint,
  udtAmount: bigint,
  convertedAmount: bigint,
  ckbFee: bigint,
  feePolicy: TesterFeePolicy,
): PlannedOrderLog {
  const feeFields = feePolicyLog(feePolicy);
  return isCkb2Udt
    ? {
        giveCkb: formatCkb(ckbAmount),
        takeIckb: formatCkb(convertedAmount),
        fee: formatCkb(ckbFee),
        ...feeFields,
      }
    : {
        giveIckb: formatCkb(udtAmount),
        takeCkb: formatCkb(convertedAmount),
        fee: formatCkb(ckbFee),
        ...feeFields,
      };
}

export async function readTesterRuntimeConfig(env: NodeJS.ProcessEnv): Promise<RuntimeConfig> {
  return readRuntimeConfigEnv(env.TESTER_CONFIG_FILE, "TESTER_CONFIG_FILE");
}

export function readTesterScenario(env: NodeJS.ProcessEnv): TesterScenario {
  const value = env.TESTER_SCENARIO ?? "auto";
  if (value === "auto") {
    return randomTesterScenario();
  }
  if (isTesterScenario(value)) {
    return value;
  }
  throw new Error("Invalid env TESTER_SCENARIO");
}

export function readTesterFeePolicy(env: NodeJS.ProcessEnv): TesterFeePolicy {
  const fee = readOptionalBigintEnv(env.TESTER_FEE, "TESTER_FEE") ?? DEFAULT_TESTER_FEE_POLICY.fee;
  const feeBase = readOptionalBigintEnv(env.TESTER_FEE_BASE, "TESTER_FEE_BASE") ?? DEFAULT_TESTER_FEE_POLICY.feeBase;
  if (fee < 0n) {
    throw new Error("Invalid env TESTER_FEE: expected a non-negative integer");
  }
  if (feeBase <= 0n) {
    throw new Error("Invalid env TESTER_FEE_BASE: expected a positive integer");
  }
  if (feeBase > MAX_TESTER_FEE_BASE) {
    throw new Error(`Invalid env TESTER_FEE_BASE: expected at most ${MAX_TESTER_FEE_BASE.toString()}`);
  }
  if (fee >= feeBase) {
    throw new Error("Invalid tester fee policy: TESTER_FEE must be less than TESTER_FEE_BASE");
  }
  return { fee, feeBase };
}

export function randomTesterScenario(random: () => number = Math.random): TesterScenario {
  const index = Math.floor(random() * TESTER_SCENARIOS.length);
  return TESTER_SCENARIOS[index] ?? "random-order";
}

export function isRetryableTesterError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("L1 state scan crossed chain tip");
}

export function postTransactionPlainCkbBalance(
  tx: ccc.Transaction,
  state: TesterState,
  accountLocks: ccc.Script[],
): bigint {
  const accountLockHexes = new Set(accountLocks.map((lock) => lock.toHex()));
  const spentOutPoints = new Set(tx.inputs.map((input) => input.previousOutput.toHex()));
  const unspentCapacity = state.account.capacityCells.reduce(
    (total, cell) => spentOutPoints.has(cell.outPoint.toHex()) ? total : total + cell.cellOutput.capacity,
    0n,
  );
  const outputCapacity = tx.outputs.reduce(
    (total, output, index) => total + (isAccountPlainCapacityOutput(output, tx.outputsData[index], accountLockHexes) ? output.capacity : 0n),
    0n,
  );

  return unspentCapacity + outputCapacity;
}

export function planTesterTransaction(
  state: Pick<TesterState, "availableCkbBalance" | "availableIckbBalance" | "system">,
  depositCapacity: bigint,
  scenario: TesterScenario,
): TesterPlan {
  if (scenario === "multi-order-limit-orders") {
    return planTesterTransaction(state, depositCapacity, resolveTesterScenario(state, scenario));
  }
  if (scenario === "extra-large-limit-order") {
    const ckbAmount = depositCapacity * 2n;
    if (state.availableCkbBalance - CKB_RESERVE < ckbAmount) {
      throw new TesterTerminalError("Not enough CKB for extra-large limit order scenario");
    }
    return { direction: "ckb-to-ickb", amount: ckbAmount, ckbAmount, udtAmount: 0n, orderCount: 1 };
  }
  if (scenario === "two-ckb-to-ickb-limit-orders") {
    const ckbAmount = state.availableCkbBalance - CKB_RESERVE - ALL_CKB_LIMIT_ORDER_OVERHEAD;
    if (ckbAmount < 2n) {
      throw new TesterTerminalError("Not enough CKB for two CKB-to-iCKB limit orders scenario");
    }
    return { direction: "ckb-to-ickb", amount: ckbAmount, ckbAmount, udtAmount: 0n, orderCount: 2 };
  }
  if (scenario === "all-ckb-limit-order") {
    const ckbAmount = state.availableCkbBalance - CKB_RESERVE - ALL_CKB_LIMIT_ORDER_OVERHEAD;
    if (ckbAmount <= 0n) {
      throw new TesterTerminalError("Not enough CKB for all-CKB limit order scenario");
    }
    return { direction: "ckb-to-ickb", amount: ckbAmount, ckbAmount, udtAmount: 0n, orderCount: 1 };
  }
  if (scenario === "all-ickb-limit-order" || scenario === "ickb-to-ckb-limit-order") {
    const udtAmount = state.availableIckbBalance;
    if (udtAmount <= 0n) {
      throw new TesterTerminalError("Not enough iCKB for iCKB-to-CKB limit order scenario");
    }
    return { direction: "ickb-to-ckb", amount: udtAmount, ckbAmount: 0n, udtAmount, orderCount: 1 };
  }
  if (scenario === "two-ickb-to-ckb-limit-orders") {
    const udtAmount = state.availableIckbBalance;
    if (udtAmount < 2n) {
      throw new TesterTerminalError("Not enough iCKB for two iCKB-to-CKB limit orders scenario");
    }
    return { direction: "ickb-to-ckb", amount: udtAmount, ckbAmount: 0n, udtAmount, orderCount: 2 };
  }
  if (scenario === "mixed-direction-limit-orders") {
    const ckbAmount = state.availableCkbBalance - CKB_RESERVE - ALL_CKB_LIMIT_ORDER_OVERHEAD;
    if (ckbAmount <= 0n) {
      throw new TesterTerminalError("Not enough CKB for mixed-direction limit orders scenario");
    }
    if (state.availableIckbBalance <= 0n) {
      throw new TesterTerminalError("Not enough iCKB for mixed-direction limit orders scenario");
    }
    return {
      direction: "ckb-to-ickb",
      amount: ckbAmount + state.availableIckbBalance,
      ckbAmount,
      udtAmount: state.availableIckbBalance,
      orderCount: 2,
    };
  }
  if (scenario === "dust-ckb-conversion") {
    if (state.availableCkbBalance - CKB_RESERVE < 1n) {
      throw new TesterTerminalError("Not enough CKB for dust CKB conversion scenario");
    }
    return { direction: "ckb-to-ickb", amount: 1n, ckbAmount: 1n, udtAmount: 0n, orderCount: 1 };
  }
  if (scenario === "dust-ickb-conversion") {
    if (state.availableIckbBalance < 1n) {
      throw new TesterTerminalError("Not enough iCKB for dust iCKB conversion scenario");
    }
    return { direction: "ickb-to-ckb", amount: 1n, ckbAmount: 0n, udtAmount: 1n, orderCount: 1 };
  }

  const ickbEquivalentBalance = convert(
    true,
    state.availableCkbBalance,
    state.system.exchangeRatio,
  );
  const totalIckbBalance = ickbEquivalentBalance + state.availableIckbBalance;
  const isCkb2Udt = sampleRatio(totalIckbBalance) <= ickbEquivalentBalance;
  const ckbAmount = isCkb2Udt
    ? min(
        isSdkConversionScenario(scenario) ? depositCapacity : sampleRatio(depositCapacity),
        state.availableCkbBalance - CKB_RESERVE,
      )
    : 0n;
  const udtAmount = isCkb2Udt
    ? 0n
    : min(
        isSdkConversionScenario(scenario) ? ICKB_DEPOSIT_CAP : sampleRatio(ICKB_DEPOSIT_CAP),
        state.availableIckbBalance,
      );

  return {
    direction: isCkb2Udt ? "ckb-to-ickb" : "ickb-to-ckb",
    amount: isCkb2Udt ? ckbAmount : udtAmount,
    ckbAmount,
    udtAmount,
    orderCount: 1,
  };
}

export function resolveTesterScenario(
  state: Pick<TesterState, "availableCkbBalance" | "availableIckbBalance" | "system">,
  scenario: TesterScenario,
  feePolicy: TesterFeePolicy = DEFAULT_TESTER_FEE_POLICY,
): TesterScenario {
  if (scenario !== "multi-order-limit-orders") {
    return scenario;
  }
  const selected = MULTI_ORDER_SCENARIOS.find((candidate) => hasPositiveMultiOrderEstimates(state, candidate, feePolicy));
  if (selected !== undefined) {
    return selected;
  }
  throw new TesterTerminalError("Not enough funds for multi-order limit orders scenario");
}

function hasPositiveMultiOrderEstimates(
  state: Pick<TesterState, "availableCkbBalance" | "availableIckbBalance" | "system">,
  scenario: TesterScenario,
  feePolicy: TesterFeePolicy,
): boolean {
  try {
    const plan = planTesterTransaction(state, 0n, scenario);
    const orders = plannedRawOrders(plan, scenario);
    return orders.length >= 2 && orders.every((order) => IckbSdk.estimate(
      order.direction === "ckb-to-ickb",
      order.amounts,
      state.system,
      { fee: feePolicy.fee, feeBase: feePolicy.feeBase },
    ).convertedAmount > 0n);
  } catch (error) {
    if (error instanceof TesterTerminalError) {
      return false;
    }
    throw error;
  }
}

function plannedRawOrders(plan: TesterPlan, scenario: TesterScenario): PlannedRawOrder[] {
  if (plan.amount <= 0n) {
    return [];
  }
  if (isSdkConversionScenario(scenario)) {
    return [{ direction: plan.direction, amounts: planAmounts(plan.direction, plan.amount), amount: plan.amount }];
  }
  if (scenario === "mixed-direction-limit-orders") {
    const orders: PlannedRawOrder[] = [
      { direction: "ckb-to-ickb", amounts: { ckbValue: plan.ckbAmount, udtValue: 0n }, amount: plan.ckbAmount },
      { direction: "ickb-to-ckb", amounts: { ckbValue: 0n, udtValue: plan.udtAmount }, amount: plan.udtAmount },
    ];
    return orders.filter((order) => order.amount > 0n);
  }
  if (plan.orderCount === 2) {
    const firstAmount = plan.amount / 2n;
    const secondAmount = plan.amount - firstAmount;
    return [firstAmount, secondAmount]
      .filter((amount) => amount > 0n)
      .map((amount) => ({ direction: plan.direction, amounts: planAmounts(plan.direction, amount), amount }));
  }
  return [{ direction: plan.direction, amounts: planAmounts(plan.direction, plan.amount), amount: plan.amount }];
}

function planAmounts(direction: TesterDirection, amount: bigint): { ckbValue: bigint; udtValue: bigint } {
  return direction === "ckb-to-ickb"
    ? { ckbValue: amount, udtValue: 0n }
    : { ckbValue: 0n, udtValue: amount };
}

function buildPlannedRawOrderTransaction(
  runtime: Runtime,
  state: TesterState,
  orders: EstimatedRawOrder[],
): Promise<ccc.Transaction> {
  if (orders.length === 1) {
    const [order] = orders;
    if (order !== undefined) {
      return buildTransaction(runtime, state, order.amounts, order.estimate.info);
    }
  }
  const rawOrders: RawOrderRequest[] = orders.map((order) => ({
    amounts: order.amounts,
    info: order.estimate.info,
  }));
  return buildRawOrderTransaction(runtime, state, rawOrders);
}

function orderEvidence(orders: EstimatedRawOrder[], feePolicy: TesterFeePolicy): Record<string, unknown> {
  const logs = orders.map((order) => orderLog(
    order.direction === "ckb-to-ickb",
    order.amounts.ckbValue,
    order.amounts.udtValue,
    order.estimate.convertedAmount,
    order.estimate.ckbFee,
    feePolicy,
  ));
  const [first] = logs;
  return logs.length === 1 && first !== undefined
    ? { newOrder: first }
    : { newOrders: logs, orderCount: logs.length };
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function sampleRatio(amount: bigint): bigint {
  if (amount <= 0n) {
    return 0n;
  }

  return (amount * randomScaled()) / RANDOM_SCALE;
}

function randomScaled(): bigint {
  return BigInt(Math.floor(Math.random() * Number(RANDOM_SCALE)));
}

function isTesterScenario(value: string): value is TesterScenario {
  return TESTER_SCENARIOS.includes(value as TesterScenario);
}

function readOptionalBigintEnv(value: string | undefined, name: string): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`Invalid env ${name}: expected an unsigned integer`);
  }
  return BigInt(value);
}

function feePolicyLog(policy: TesterFeePolicy): Pick<PlannedOrderLog, "feeNumerator" | "feeBase"> {
  return {
    feeNumerator: policy.fee.toString(),
    feeBase: policy.feeBase.toString(),
  };
}

function isExplicitCkbReserveScenario(scenario: TesterScenario): boolean {
  return scenario === "all-ckb-limit-order" || scenario === "extra-large-limit-order" || scenario === "two-ckb-to-ickb-limit-orders" || scenario === "mixed-direction-limit-orders";
}

function isSdkConversionScenario(scenario: TesterScenario): boolean {
  return scenario === "sdk-conversion";
}

function isAccountPlainCapacityOutput(output: ccc.CellOutput, outputData: string | undefined, accountLockHexes: Set<string>): boolean {
  return output.type === undefined && (outputData ?? "0x") === "0x" && accountLockHexes.has(output.lock.toHex());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
  process.exit(process.exitCode ?? 0);
}
