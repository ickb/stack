import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP, convert } from "@ickb/core";
import { IckbSdk, estimateMaturityFeeThreshold, getConfig, sendAndWaitForCommit } from "@ickb/sdk";
import {
  accountPlainCkbBalance,
  createPublicClient,
  formatCkb,
  handleLoopError,
  logExecution,
  postTransactionAccountPlainCkbBalance,
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
  readTesterState,
  type Runtime,
  type RawOrderRequest,
  type TesterState,
} from "./runtime.js";
import { freshMatchableOrderSkip } from "./freshMatchableOrderSkip.js";
const CKB = ccc.fixedPointFrom(1);
const CKB_RESERVE = 2000n * CKB;
const ALL_CKB_LIMIT_ORDER_OVERHEAD = 1000n * CKB;
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
  "ickb-to-ckb-limit-order",
  "bounded-ickb-to-ckb-limit-order",
  "two-ickb-to-ckb-limit-orders",
  "mixed-direction-limit-orders",
  "dust-ckb-conversion",
  "dust-ickb-conversion",
] as const;
export type TesterScenario = typeof TESTER_SCENARIOS[number];
export type TesterScenarioSelection = TesterScenario | "auto";
const AUTO_TESTER_SCENARIOS: readonly TesterScenario[] = [
  "random-order",
  "sdk-conversion",
  "bounded-ickb-to-ckb-limit-order",
];
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
  fee?: string;
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
export type TesterExecutionActions = Record<string, unknown>;

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

  let startedAttempts = 0;
  let completedIterations = 0;
  for (;;) {
    if (shouldSleepBeforeTesterAttempt(startedAttempts)) {
      await sleep(randomSleepIntervalMs(sleepIntervalMs));
    }
    startedAttempts += 1;

    const executionLog: Record<string, unknown> = {};
    const startTime = new Date();
    let stopAfterLog = false;
    executionLog.startTime = startTime.toLocaleString();

    try {
      const state = await readTesterState(runtime);
      const skip = await freshMatchableOrderSkip(
        runtime,
        state.userOrders,
        state.system.tip,
        state.system.feeRate,
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

      const effectiveTesterScenario = resolveTesterScenario(state, testerScenario, feePolicy, depositCapacity);
      if (effectiveTesterScenario === undefined) {
        if (totalEquivalentCkb < depositCapacity / MIN_TOTAL_CAPITAL_DIVISOR) {
          executionLog.error =
            "Not enough funds to continue testing, shutting down...";
          logExecution(executionLog, startTime);
          return;
        }
        executionLog.skip = testerNoActionableAutoScenarioSkip();
        if (logTerminalIteration(executionLog, startTime, ++completedIterations, maxIterations)) {
          return;
        }
        continue;
      }
      const plan = planTesterTransaction(state, depositCapacity, effectiveTesterScenario, feePolicy);
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
      const estimatedOrders: EstimatedRawOrder[] = [];
      let estimateUnavailable = false;
      for (const order of rawOrders) {
        const estimate = estimateRawOrder(order, state.system, effectiveFeePolicy);
        if (estimate === undefined) {
          estimateUnavailable = true;
          break;
        }
        estimatedOrders.push({ ...order, estimate });
      }
      if (estimateUnavailable || estimatedOrders.some((order) => order.estimate.convertedAmount <= 0n)) {
        executionLog.skip = testerEstimatedTooSmallSkip(
          testerScenario,
          effectiveTesterScenario,
          rawOrders,
          estimatedOrders,
          effectiveFeePolicy,
        );
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

      const reserveSkip = enforceTesterPlainCkbReserve(tx, state, runtime.accountLocks, effectiveTesterScenario);
      if (reserveSkip !== undefined) {
        executionLog.skip = {
          ...reserveSkip,
          ...testerAttemptedTransactionEvidence(
            testerScenario,
            effectiveTesterScenario,
            built.conversion,
            attemptedOrderEvidence(rawOrders, estimatedOrders, effectiveFeePolicy),
          ),
        };
        if (logTerminalIteration(executionLog, startTime, ++completedIterations, maxIterations)) {
          return;
        }
        continue;
      }

      executionLog.actions = testerExecutionActions(
        testerScenario,
        effectiveTesterScenario,
        built.conversion,
        estimatedOrders,
        effectiveFeePolicy,
        state,
      );
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
      stopAfterLog = handleLoopError(executionLog, e);
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

export function shouldSleepBeforeTesterAttempt(startedAttempts: number): boolean {
  return startedAttempts > 0;
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

export function readTesterScenario(env: NodeJS.ProcessEnv): TesterScenarioSelection {
  const value = env.TESTER_SCENARIO ?? "auto";
  if (value === "auto") {
    return "auto";
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

export function randomTesterScenario(
  random: () => number = Math.random,
  scenarios: readonly TesterScenario[] = TESTER_SCENARIOS,
): TesterScenario {
  const index = Math.floor(random() * scenarios.length);
  return scenarios[index] ?? "random-order";
}

export function isRetryableTesterError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("L1 state scan crossed chain tip");
}

export function postTransactionPlainCkbBalance(
  tx: ccc.Transaction,
  state: TesterState,
  accountLocks: ccc.Script[],
): bigint {
  return postTransactionAccountPlainCkbBalance(tx, state.account.capacityCells, accountLocks);
}

export function testerReserveSkip(postTxCkbBalance: bigint): Record<string, string> | undefined {
  if (postTxCkbBalance >= CKB_RESERVE) {
    return undefined;
  }
  return {
    reason: "post-tx-ckb-reserve",
    reserve: formatCkb(CKB_RESERVE),
    postTxCkbBalance: formatCkb(postTxCkbBalance),
  };
}

export function enforceTesterPlainCkbReserve(
  tx: ccc.Transaction,
  state: TesterState,
  accountLocks: ccc.Script[],
  scenario: TesterScenario,
): Record<string, string> | undefined {
  const preTxCkbBalance = accountPlainCkbBalance(state.account.capacityCells, accountLocks);
  const postTxCkbBalance = postTransactionPlainCkbBalance(tx, state, accountLocks);
  const reserveSkip = testerReserveSkip(postTxCkbBalance);
  if (reserveSkip === undefined || postTxCkbBalance >= preTxCkbBalance) {
    return undefined;
  }
  if (isExplicitCkbReserveScenario(scenario)) {
    throw new TesterTerminalError(
      `Not enough CKB to preserve tester reserve after the tx: expected ${formatCkb(CKB_RESERVE)} CKB, got ${formatCkb(postTxCkbBalance)} CKB`,
    );
  }
  return reserveSkip;
}

export function testerExecutionActions(
  requestedScenario: TesterScenarioSelection,
  effectiveScenario: TesterScenario,
  conversion: unknown,
  estimatedOrders: EstimatedRawOrder[],
  feePolicy: TesterFeePolicy,
  state: Pick<TesterState, "userOrders">,
): TesterExecutionActions {
  const conversionRecord = isRecord(conversion) ? conversion : undefined;
  const collectedOrders = state.userOrders.length;
  const cancelledOrders = state.userOrders.filter((group) => group.order.isMatchable()).length;
  return {
    ...(effectiveScenario === requestedScenario ? {} : { requestedTesterScenario: requestedScenario }),
    testerScenario: effectiveScenario,
    ...(conversionRecord === undefined ? {} : { conversion: conversionRecord }),
    ...(conversionRecord === undefined ? orderEvidence(estimatedOrders, feePolicy) : {}),
    collectedOrders,
    cancelledOrders,
  };
}

export function testerEstimatedTooSmallSkip(
  requestedScenario: TesterScenarioSelection,
  effectiveScenario: TesterScenario,
  rawOrders: PlannedRawOrder[],
  estimatedOrders: EstimatedRawOrder[],
  feePolicy: TesterFeePolicy,
): Record<string, unknown> {
  return {
    reason: "estimated-conversion-too-small",
    ...(effectiveScenario === requestedScenario ? {} : { requestedTesterScenario: requestedScenario }),
    testerScenario: effectiveScenario,
    ...attemptedOrderEvidence(rawOrders, estimatedOrders, feePolicy),
  };
}

export function testerNoActionableAutoScenarioSkip(): Record<string, unknown> {
  return {
    reason: "estimated-conversion-too-small",
    requestedTesterScenario: "auto",
    attemptedTesterScenarios: [...AUTO_TESTER_SCENARIOS],
  };
}

export function testerAttemptedTransactionEvidence(
  requestedScenario: TesterScenarioSelection,
  effectiveScenario: TesterScenario,
  conversion: unknown,
  orderEvidence: Record<string, unknown>,
): Record<string, unknown> {
  const conversionRecord = isRecord(conversion) ? conversion : undefined;
  return {
    ...(effectiveScenario === requestedScenario ? {} : { requestedTesterScenario: requestedScenario }),
    testerScenario: effectiveScenario,
    ...(conversionRecord === undefined ? orderEvidence : { attemptedConversion: conversionRecord }),
  };
}

export function planTesterTransaction(
  state: Pick<TesterState, "availableCkbBalance" | "availableIckbBalance" | "system">,
  depositCapacity: bigint,
  scenario: TesterScenario,
  feePolicy: TesterFeePolicy = DEFAULT_TESTER_FEE_POLICY,
): TesterPlan {
  if (scenario === "multi-order-limit-orders") {
    return planTesterTransaction(state, depositCapacity, resolveMultiOrderScenario(state, feePolicy), feePolicy);
  }
  if (scenario === "sdk-conversion") {
    return planSdkConversionTransaction(state, depositCapacity);
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
  if (scenario === "ickb-to-ckb-limit-order") {
    const udtAmount = state.availableIckbBalance;
    if (udtAmount <= 0n) {
      throw new TesterTerminalError("Not enough iCKB for iCKB-to-CKB limit order scenario");
    }
    return { direction: "ickb-to-ckb", amount: udtAmount, ckbAmount: 0n, udtAmount, orderCount: 1 };
  }
  if (scenario === "bounded-ickb-to-ckb-limit-order") {
    const udtAmount = min(ICKB_DEPOSIT_CAP, state.availableIckbBalance);
    if (udtAmount <= 0n) {
      throw new TesterTerminalError("Not enough iCKB for bounded iCKB-to-CKB limit order scenario");
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

  const spendableCkbBalance = max(0n, state.availableCkbBalance - CKB_RESERVE);
  return planRandomOrderTransaction(state, depositCapacity, feePolicy, spendableCkbBalance);
}

export function resolveTesterScenario(
  state: Pick<TesterState, "availableCkbBalance" | "availableIckbBalance" | "system">,
  scenario: TesterScenarioSelection,
  feePolicy: TesterFeePolicy = DEFAULT_TESTER_FEE_POLICY,
  depositCapacity = 0n,
  random: () => number = Math.random,
): TesterScenario | undefined {
  if (scenario === "auto") {
    const fundedScenarios = fundedTesterScenarios(state, depositCapacity, feePolicy, AUTO_TESTER_SCENARIOS);
    if (fundedScenarios.length === 0) {
      return undefined;
    }
    return randomTesterScenario(random, fundedScenarios);
  }
  if (scenario !== "multi-order-limit-orders") {
    return scenario;
  }
  return resolveMultiOrderScenario(state, feePolicy);
}

function resolveMultiOrderScenario(
  state: Pick<TesterState, "availableCkbBalance" | "availableIckbBalance" | "system">,
  feePolicy: TesterFeePolicy,
): TesterScenario {
  const selected = MULTI_ORDER_SCENARIOS.find((candidate) => hasPositiveMultiOrderEstimates(state, candidate, feePolicy));
  if (selected !== undefined) {
    return selected;
  }
  throw new TesterTerminalError("Not enough funds for multi-order limit orders scenario");
}

function fundedTesterScenarios(
  state: Pick<TesterState, "availableCkbBalance" | "availableIckbBalance" | "system">,
  depositCapacity: bigint,
  feePolicy: TesterFeePolicy,
  candidates: readonly TesterScenario[],
): TesterScenario[] {
  return candidates.filter((scenario) => {
    if (scenario === "random-order") {
      return hasActionableRandomOrderEstimate(state, depositCapacity, feePolicy);
    }
    if (scenario === "sdk-conversion") {
      return hasBuildableSdkConversionEstimate(state, depositCapacity);
    }
    try {
      const plan = planTesterTransaction(state, depositCapacity, scenario);
      const orders = plannedRawOrders(plan, scenario);
      return orders.length > 0 && orders.every((order) => {
        const estimate = estimateRawOrder(order, state.system, feePolicy);
        return estimate !== undefined && estimate.convertedAmount > 0n;
      });
    } catch (error) {
      if (error instanceof TesterTerminalError) {
        return false;
      }
      throw error;
    }
  });
}

function hasBuildableSdkConversionEstimate(
  state: Pick<TesterState, "availableCkbBalance" | "availableIckbBalance" | "system">,
  depositCapacity: bigint,
): boolean {
  try {
    planSdkConversionTransaction(state, depositCapacity);
    return true;
  } catch (error) {
    if (error instanceof TesterTerminalError) {
      return false;
    }
    throw error;
  }
}

function planSdkConversionTransaction(
  state: Pick<TesterState, "availableCkbBalance" | "availableIckbBalance" | "system">,
  depositCapacity: bigint,
): TesterPlan {
  const spendableCkbBalance = max(0n, state.availableCkbBalance - CKB_RESERVE);
  const ckbPlan = buildableSdkConversionPlan(state, "ckb-to-ickb", min(depositCapacity, spendableCkbBalance), depositCapacity);
  if (ckbPlan !== undefined) {
    return ckbPlan;
  }

  const udtPlan = buildableSdkConversionPlan(state, "ickb-to-ckb", min(ICKB_DEPOSIT_CAP, state.availableIckbBalance), depositCapacity);
  if (udtPlan !== undefined) {
    return udtPlan;
  }

  throw new TesterTerminalError("Not enough funds for SDK conversion scenario");
}

function buildableSdkConversionPlan(
  state: Pick<TesterState, "system">,
  direction: TesterDirection,
  amount: bigint,
  depositCapacity: bigint,
): TesterPlan | undefined {
  if (amount <= 0n) {
    return undefined;
  }
  const order: PlannedRawOrder = { direction, amounts: planAmounts(direction, amount), amount };
  const estimate = estimateRawOrder(order, state.system, DEFAULT_TESTER_FEE_POLICY);
  if (estimate === undefined || estimate.convertedAmount <= 0n) {
    return undefined;
  }
  const plan = {
    direction,
    amount,
    ckbAmount: direction === "ckb-to-ickb" ? amount : 0n,
    udtAmount: direction === "ickb-to-ckb" ? amount : 0n,
    orderCount: 1,
  };
  return isBuildableSdkConversionOrder(plan, order, estimate, state.system, depositCapacity) ? plan : undefined;
}

function hasActionableRandomOrderEstimate(
  state: Pick<TesterState, "availableCkbBalance" | "availableIckbBalance" | "system">,
  depositCapacity: bigint,
  feePolicy: TesterFeePolicy,
): boolean {
  const spendableCkbBalance = max(0n, state.availableCkbBalance - CKB_RESERVE);
  return minimumActionableRandomOrderAmount(
    "ckb-to-ickb",
    min(depositCapacity, spendableCkbBalance),
    state.system,
    feePolicy,
  ) !== undefined || minimumActionableRandomOrderAmount(
    "ickb-to-ckb",
    min(ICKB_DEPOSIT_CAP, state.availableIckbBalance),
    state.system,
    feePolicy,
  ) !== undefined;
}

function planRandomOrderTransaction(
  state: Pick<TesterState, "availableCkbBalance" | "availableIckbBalance" | "system">,
  depositCapacity: bigint,
  feePolicy: TesterFeePolicy,
  spendableCkbBalance: bigint,
): TesterPlan {
  const ckbMax = min(depositCapacity, spendableCkbBalance);
  const udtMax = min(ICKB_DEPOSIT_CAP, state.availableIckbBalance);
  const ckbMin = minimumActionableRandomOrderAmount("ckb-to-ickb", ckbMax, state.system, feePolicy);
  const udtMin = minimumActionableRandomOrderAmount("ickb-to-ckb", udtMax, state.system, feePolicy);
  const ckbWeight = ckbMin === undefined ? 0n : convert(true, ckbMax, state.system.exchangeRatio);
  const udtWeight = udtMin === undefined ? 0n : udtMax;
  const isCkb2Udt = ckbWeight > 0n && (udtWeight === 0n || sampleRatio(ckbWeight + udtWeight) < ckbWeight);
  if (isCkb2Udt && ckbMin !== undefined) {
    const ckbAmount = sampleAmount(ckbMin, ckbMax);
    return { direction: "ckb-to-ickb", amount: ckbAmount, ckbAmount, udtAmount: 0n, orderCount: 1 };
  }
  if (udtMin !== undefined) {
    const udtAmount = sampleAmount(udtMin, udtMax);
    return { direction: "ickb-to-ckb", amount: udtAmount, ckbAmount: 0n, udtAmount, orderCount: 1 };
  }
  return { direction: "ckb-to-ickb", amount: 0n, ckbAmount: 0n, udtAmount: 0n, orderCount: 1 };
}

function minimumActionableRandomOrderAmount(
  direction: TesterDirection,
  maxAmount: bigint,
  system: TesterState["system"],
  feePolicy: TesterFeePolicy,
): bigint | undefined {
  if (maxAmount <= 0n || !isActionableRandomOrderAmount(direction, maxAmount, system, feePolicy)) {
    return undefined;
  }
  let low = 1n;
  let high = maxAmount;
  while (low < high) {
    const mid = (low + high) / 2n;
    if (isActionableRandomOrderAmount(direction, mid, system, feePolicy)) {
      high = mid;
    } else {
      low = mid + 1n;
    }
  }
  return low;
}

function isActionableRandomOrderAmount(
  direction: TesterDirection,
  amount: bigint,
  system: TesterState["system"],
  feePolicy: TesterFeePolicy,
): boolean {
  const order: PlannedRawOrder = { direction, amounts: planAmounts(direction, amount), amount };
  const estimate = estimateRawOrder(order, system, feePolicy);
  return estimate !== undefined &&
    estimate.convertedAmount >= minimumMatcherOutput(direction, estimate.info) &&
    estimate.ckbFee >= estimateMaturityFeeThreshold(system);
}

function minimumMatcherOutput(direction: TesterDirection, info: ReturnType<typeof IckbSdk.estimate>["info"]): bigint {
  const minimumCkb = info.getCkbMinMatch();
  if (direction === "ckb-to-ickb") {
    const { ckbScale, udtScale } = info.ckbToUdt;
    return (minimumCkb * udtScale + ckbScale - 1n) / ckbScale;
  }
  return minimumCkb;
}

function hasPositiveMultiOrderEstimates(
  state: Pick<TesterState, "availableCkbBalance" | "availableIckbBalance" | "system">,
  scenario: TesterScenario,
  feePolicy: TesterFeePolicy,
): boolean {
  try {
    const plan = planTesterTransaction(state, 0n, scenario);
    const orders = plannedRawOrders(plan, scenario);
    return orders.length >= 2 && orders.every((order) => {
      const estimate = estimateRawOrder(order, state.system, feePolicy);
      return estimate !== undefined && estimate.convertedAmount > 0n;
    });
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
  const rawOrders: RawOrderRequest[] = orders.map((order) => ({
    amounts: order.amounts,
    info: order.estimate.info,
  }));
  return buildRawOrderTransaction(runtime, state, rawOrders);
}

function estimateRawOrder(
  order: PlannedRawOrder,
  system: TesterState["system"],
  feePolicy: TesterFeePolicy,
): ReturnType<typeof IckbSdk.estimate> | undefined {
  try {
    return IckbSdk.estimate(order.direction === "ckb-to-ickb", order.amounts, system, {
      fee: feePolicy.fee,
      feeBase: feePolicy.feeBase,
    });
  } catch (error) {
    if (isUnrepresentableTesterEstimateError(error)) {
      return undefined;
    }
    throw error;
  }
}

export function isUnrepresentableTesterEstimateError(error: unknown): boolean {
  return error instanceof Error && error.message === "Ratio scale exceeds Uint64";
}

function isBuildableSdkConversionOrder(
  plan: TesterPlan,
  order: PlannedRawOrder,
  estimate: ReturnType<typeof IckbSdk.estimate>,
  system: TesterState["system"],
  depositCapacity: bigint,
): boolean {
  if (order.direction === "ckb-to-ickb") {
    return plan.amount >= depositCapacity || estimate.maturity !== undefined;
  }
  return IckbSdk.estimateIckbToCkbOrder(order.amounts, system) !== undefined;
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

function attemptedOrderEvidence(
  rawOrders: PlannedRawOrder[],
  estimatedOrders: EstimatedRawOrder[],
  feePolicy: TesterFeePolicy,
): Record<string, unknown> {
  const logs = rawOrders.map((order, index) => attemptedOrderLog(order, estimatedOrders[index], feePolicy));
  const [first] = logs;
  return logs.length === 1 && first !== undefined
    ? { attemptedOrder: first }
    : { attemptedOrders: logs, attemptedOrderCount: logs.length };
}

function attemptedOrderLog(
  order: PlannedRawOrder,
  estimatedOrder: EstimatedRawOrder | undefined,
  feePolicy: TesterFeePolicy,
): PlannedOrderLog {
  if (estimatedOrder !== undefined) {
    return orderLog(
      estimatedOrder.direction === "ckb-to-ickb",
      estimatedOrder.amounts.ckbValue,
      estimatedOrder.amounts.udtValue,
      estimatedOrder.estimate.convertedAmount,
      estimatedOrder.estimate.ckbFee,
      feePolicy,
    );
  }
  const feeFields = feePolicyLog(feePolicy);
  return order.direction === "ckb-to-ickb"
    ? { giveCkb: formatCkb(order.amounts.ckbValue), ...feeFields }
    : { giveIckb: formatCkb(order.amounts.udtValue), ...feeFields };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function max(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function sampleRatio(amount: bigint): bigint {
  if (amount <= 0n) {
    return 0n;
  }

  return (amount * randomScaled()) / RANDOM_SCALE;
}

function sampleAmount(minimum: bigint, maximum: bigint): bigint {
  return minimum + sampleRatio(maximum - minimum + 1n);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
  process.exit(process.exitCode ?? 0);
}
