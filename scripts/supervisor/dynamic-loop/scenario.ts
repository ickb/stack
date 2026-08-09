import {
  CKB,
  ICKB_STIMULUS_MIN_ICKB,
} from "../../../packages/validation/src/supervisor/stimulus/shared/liveBotStimulusConstants.ts";
import { allCkbLimitOrderMinimum } from "../../../packages/validation/src/supervisor/stimulus/shared/stimulusArithmetic.ts";
import {
  DEFAULT_RAW_ORDER_FEE_POLICY,
  ICKB_STIMULUS_MIN_CKB,
  type TesterChoice,
  type TesterScenarioInput,
} from "./model.ts";
export function chooseTesterScenario({
  ckb,
  plainCkb,
  ickb,
  feeRate,
  rawOrderFeePolicy = DEFAULT_RAW_ORDER_FEE_POLICY,
}: TesterScenarioInput): TesterChoice {
  const plainSpendableCkb = plainCkb ?? ckb;
  const allCkbMinimum = allCkbLimitOrderMinimum(feeRate, rawOrderFeePolicy);
  if (allCkbMinimum !== undefined && plainSpendableCkb >= allCkbMinimum) {
    return { scenario: "all-ckb-limit-order", feeArgs: [] };
  }
  if (
    plainSpendableCkb >= ICKB_STIMULUS_MIN_CKB * CKB &&
    ickb >= ICKB_STIMULUS_MIN_ICKB * CKB
  ) {
    return {
      scenario: "ickb-to-ckb-limit-order",
      feeArgs: ["--tester-fee", "1", "--tester-fee-base", "1000"],
    };
  }
  return { scenario: "auto", feeArgs: [] };
}
