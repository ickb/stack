import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  AUTO_SCENARIO,
  BOUNDED_ICKB_TO_CKB_FEE_POLICY,
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  CKB,
  CKB_SPENDING_STIMULUS_BUFFER,
  DEFAULT_TESTER_FEE_POLICY,
  EXTRA_LARGE_LIMIT_ORDER_DEPOSIT_MULTIPLIER,
  EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
  ICKB_STIMULUS_MIN_ICKB,
} from "../shared/liveBotStimulusConstants.ts";
import type {
  LiveBotStimulusTesterScenarioSelection,
  StimulusBalances,
  StimulusChoice,
} from "../shared/liveBotStimulusTypes.ts";
import { recordField, stringField } from "../shared/liveBotStimulusUtils.ts";
import {
  allCkbLimitOrderMinimum,
  fixed8DecimalToUnits,
  parseCanonicalUnsignedInteger,
} from "../shared/stimulusArithmetic.ts";

/**
 * Chooses one bounded stimulus from the tester's public balances.
 */
export function chooseLiveBotStimulus(args: {
  tester: StimulusBalances;
  requestedScenario: LiveBotStimulusTesterScenarioSelection;
  testerFee?: string;
  testerFeeBase?: string;
}): StimulusChoice {
  const feePolicy = rawOrderFeePolicy(args.testerFee, args.testerFeeBase);
  if (args.requestedScenario !== AUTO_SCENARIO) {
    const explicitChoice = scenarioChoice(args, args.requestedScenario, feePolicy);
    if (explicitChoice === undefined) {
      throw new Error(
        `Explicit tester scenario ${args.requestedScenario} is not fundable from public preflight balances`,
      );
    }
    return explicitChoice;
  }

  const extraLargeChoice = scenarioChoice(
    args,
    EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
    feePolicy,
  );
  if (extraLargeChoice !== undefined) {
    return extraLargeChoice;
  }
  const allCkbChoice = scenarioChoice(args, ALL_CKB_LIMIT_ORDER_SCENARIO, feePolicy);
  if (allCkbChoice !== undefined) {
    return allCkbChoice;
  }
  const boundedIckbToCkbChoice = scenarioChoice(
    args,
    BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
    feePolicy,
  );
  if (boundedIckbToCkbChoice !== undefined) {
    return boundedIckbToCkbChoice;
  }
  throw new Error(
    "No tester stimulus is currently fundable from public preflight balances",
  );
}

function scenarioChoice(
  args: {
    tester: StimulusBalances;
    testerFee?: string;
    testerFeeBase?: string;
  },
  scenario: Exclude<LiveBotStimulusTesterScenarioSelection, typeof AUTO_SCENARIO>,
  feePolicy: { fee: bigint; feeBase: bigint },
): StimulusChoice | undefined {
  if (scenario === ALL_CKB_LIMIT_ORDER_SCENARIO) {
    return ckbToIckbChoice(args, feePolicy);
  }
  if (scenario === EXTRA_LARGE_LIMIT_ORDER_SCENARIO) {
    return extraLargeCkbToIckbChoice(args, feePolicy);
  }
  return boundedIckbToCkbChoice(args);
}

function ckbToIckbChoice(
  args: {
    tester: StimulusBalances;
    testerFee?: string;
    testerFeeBase?: string;
  },
  feePolicy: { fee: bigint; feeBase: bigint },
): StimulusChoice | undefined {
  const allCkbOrderAmount = allCkbLimitOrderAmount(args.tester.projectedCkb);
  const allCkbMinimum = allCkbLimitOrderMinimum(args.tester.feeRate, feePolicy);
  if (allCkbOrderAmount <= 0n || allCkbMinimum === undefined) {
    return undefined;
  }
  if (args.tester.projectedCkb < allCkbMinimum) {
    return undefined;
  }
  return {
    scenario: ALL_CKB_LIMIT_ORDER_SCENARIO,
    testerFee: args.testerFee,
    testerFeeBase: args.testerFeeBase,
    reason:
      "tester projected CKB funds one all-CKB limit order after retaining its spending buffer",
  };
}

function extraLargeCkbToIckbChoice(
  args: {
    tester: StimulusBalances;
    testerFee?: string;
    testerFeeBase?: string;
  },
  feePolicy: { fee: bigint; feeBase: bigint },
): StimulusChoice | undefined {
  const orderAmount =
    args.tester.depositCapacity * EXTRA_LARGE_LIMIT_ORDER_DEPOSIT_MULTIPLIER;
  const minimum = allCkbLimitOrderMinimum(args.tester.feeRate, feePolicy);
  if (orderAmount <= 0n || minimum === undefined) {
    return undefined;
  }
  if (
    args.tester.projectedCkb < minimum ||
    args.tester.projectedCkb < CKB_SPENDING_STIMULUS_BUFFER * CKB + orderAmount
  ) {
    return undefined;
  }
  return {
    scenario: EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
    testerFee: args.testerFee,
    testerFeeBase: args.testerFeeBase,
    reason: "tester projected CKB funds a deposit-cap-bounded CKB-to-iCKB limit order",
  };
}

function boundedIckbToCkbChoice(args: {
  tester: StimulusBalances;
  testerFee?: string;
  testerFeeBase?: string;
}): StimulusChoice | undefined {
  if (args.tester.ickbAvailable < ICKB_STIMULUS_MIN_ICKB * CKB) {
    return undefined;
  }
  return {
    scenario: BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
    testerFee: args.testerFee ?? BOUNDED_ICKB_TO_CKB_FEE_POLICY.fee,
    testerFeeBase: args.testerFeeBase ?? BOUNDED_ICKB_TO_CKB_FEE_POLICY.feeBase,
    reason: "tester iCKB funds one deposit-cap-bounded iCKB-to-CKB limit order",
  };
}

export function balancesFromPreflight(report: Record<string, unknown>): StimulusBalances {
  const balances = recordField(report, "balances");
  const ckb = recordField(balances, "CKB");
  const ickb = recordField(balances, "ICKB");
  const system = recordField(report, "system");
  const capital = recordField(report, "capital");
  const depositCapacity = fixed8DecimalToUnits(stringField(capital, "depositCapacity"));
  const projectedCkb = fixed8DecimalToUnits(
    stringField(ckb, "projectedAvailable") ?? stringField(ckb, "available"),
  );
  const ickbAvailable = fixed8DecimalToUnits(stringField(ickb, "available"));
  const feeRate = parseCanonicalUnsignedInteger(system?.["feeRate"]);
  if (
    depositCapacity === undefined ||
    projectedCkb === undefined ||
    ickbAvailable === undefined ||
    feeRate === undefined
  ) {
    throw new Error(
      "preflight report missing public balances or fee rate required for tester stimulus selection",
    );
  }
  return {
    depositCapacity,
    projectedCkb,
    ickbAvailable,
    feeRate,
  };
}

export function assertUnboundedBotLivePreflight(report: Record<string, unknown>): void {
  if (report["bounded"] === false && report["maxIterations"] === undefined) {
    return;
  }
  throw new Error(
    "bot live stimulus test requires unbounded config/bot-live-testnet.json preflight evidence",
  );
}

function allCkbLimitOrderAmount(availableCkb: bigint): bigint {
  return availableCkb - CKB_SPENDING_STIMULUS_BUFFER * CKB;
}

function rawOrderFeePolicy(
  fee: string | undefined,
  feeBase: string | undefined,
): { fee: bigint; feeBase: bigint } {
  return {
    fee: fee === undefined ? DEFAULT_TESTER_FEE_POLICY.fee : BigInt(fee),
    feeBase: feeBase === undefined ? DEFAULT_TESTER_FEE_POLICY.feeBase : BigInt(feeBase),
  };
}
