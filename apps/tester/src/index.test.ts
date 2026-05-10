import { describe, expect, it } from "vitest";
import { parseSleepInterval } from "./index.js";

describe("parseSleepInterval", () => {
  it("rejects missing, non-finite, NaN, and sub-second intervals", () => {
    for (const value of [undefined, "", "abc", "NaN", "Infinity", "0", "0.5"]) {
      expect(() => parseSleepInterval(value, "TESTER_SLEEP_INTERVAL")).toThrow(
        "Invalid env TESTER_SLEEP_INTERVAL",
      );
    }
  });

  it("returns milliseconds for valid second intervals", () => {
    expect(parseSleepInterval("1", "TESTER_SLEEP_INTERVAL")).toBe(1000);
    expect(parseSleepInterval("2.5", "TESTER_SLEEP_INTERVAL")).toBe(2500);
  });
});
