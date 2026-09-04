import { describe, expect, it } from "vitest";
import {
  AUTO_TESTER_SCENARIO,
  DEFAULT_TESTER_FEE_POLICY,
  RANDOM_ORDER_SCENARIO,
  TESTER_SCENARIOS,
  TESTER_SCENARIO_SELECTIONS,
  isTesterScenarioSelection,
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
    expect(isTesterScenarioSelection(AUTO_TESTER_SCENARIO)).toBe(true);
    expect(isTesterScenarioSelection("unknown")).toBe(false);
  });

  it("exposes the shared fee policy", () => {
    expect(DEFAULT_TESTER_FEE_POLICY).toEqual({ fee: 1n, feeBase: 100000n });
  });
});
