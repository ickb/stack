import { describe, expect, it } from "vitest";
import {
  AUTO_TESTER_SCENARIO,
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  DEFAULT_TESTER_FEE_POLICY,
  DUST_ICKB_CONVERSION_SCENARIO,
  ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  RANDOM_ORDER_SCENARIO,
  SDK_CONVERSION_SCENARIO,
  TESTER_SCENARIOS,
  TESTER_SCENARIO_SELECTIONS,
  isIckbToCkbTesterScenario,
  isSdkConversionTesterScenario,
  isTesterScenario,
  isTesterScenarioSelection,
  testerScenarioSelectionErrorText,
  testerScenarioSelectionListText,
} from "../src/testerContract.ts";

describe("tester validation contract", () => {
  it("separates concrete tester scenarios from the auto selector", () => {
    expect(TESTER_SCENARIOS).toContain(RANDOM_ORDER_SCENARIO);
    expect(TESTER_SCENARIOS).not.toContain(AUTO_TESTER_SCENARIO);
    expect(TESTER_SCENARIO_SELECTIONS).toEqual([
      AUTO_TESTER_SCENARIO,
      ...TESTER_SCENARIOS,
    ]);
  });

  it("classifies scenario strings", () => {
    expect(isTesterScenario(RANDOM_ORDER_SCENARIO)).toBe(true);
    expect(isTesterScenario(AUTO_TESTER_SCENARIO)).toBe(false);
    expect(isTesterScenarioSelection(AUTO_TESTER_SCENARIO)).toBe(true);
    expect(isTesterScenarioSelection("unknown")).toBe(false);
  });

  it("exposes shared fee and direction group semantics", () => {
    expect(DEFAULT_TESTER_FEE_POLICY).toEqual({ fee: 1n, feeBase: 100000n });
    expect(isSdkConversionTesterScenario(SDK_CONVERSION_SCENARIO)).toBe(true);
    expect(isSdkConversionTesterScenario(RANDOM_ORDER_SCENARIO)).toBe(false);
    expect(isIckbToCkbTesterScenario(ICKB_TO_CKB_LIMIT_ORDER_SCENARIO)).toBe(true);
    expect(isIckbToCkbTesterScenario(BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO)).toBe(
      true,
    );
    expect(isIckbToCkbTesterScenario(DUST_ICKB_CONVERSION_SCENARIO)).toBe(true);
    expect(isIckbToCkbTesterScenario(RANDOM_ORDER_SCENARIO)).toBe(false);
  });

  it("formats scenario selections for CLI surfaces", () => {
    expect(
      testerScenarioSelectionListText([AUTO_TESTER_SCENARIO, RANDOM_ORDER_SCENARIO]),
    ).toBe("auto|random-order");
    expect(
      testerScenarioSelectionErrorText([AUTO_TESTER_SCENARIO, RANDOM_ORDER_SCENARIO]),
    ).toBe("auto, random-order");
  });
});
