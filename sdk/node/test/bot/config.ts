import { describe, expect, it } from "vitest";
import { readBotMaxFeeRate, readBotTurnMs } from "../../src/bot/config.ts";

describe("readBotMaxFeeRate", () => {
  it("leaves the sampled rate uncapped when the knob is unset or empty", () => {
    expect(readBotMaxFeeRate({})).toBeUndefined();
    expect(readBotMaxFeeRate({ BOT_MAX_FEE_RATE: "" })).toBeUndefined();
  });

  it("reads an integer at or above the node admission floor", () => {
    expect(readBotMaxFeeRate({ BOT_MAX_FEE_RATE: "1000" })).toBe(1000n);
    expect(readBotMaxFeeRate({ BOT_MAX_FEE_RATE: "33222" })).toBe(33_222n);
  });

  it("rejects a non-integer or a value below the floor, naming only the variable", () => {
    for (const value of ["999", "0", "1e3", "1000.5", "-1000", " 1000", "0x3e8"]) {
      expect(() => readBotMaxFeeRate({ BOT_MAX_FEE_RATE: value })).toThrow(
        "Invalid env BOT_MAX_FEE_RATE: expected an integer of at least 1000",
      );
    }
  });
});

describe("readBotTurnMs", () => {
  it("defaults to ten minutes when unset or empty", () => {
    expect(readBotTurnMs({})).toBe(600_000);
    expect(readBotTurnMs({ BOT_TURN_MINUTES: "" })).toBe(600_000);
  });

  it("reads whole minutes from 1 to 10", () => {
    expect(readBotTurnMs({ BOT_TURN_MINUTES: "1" })).toBe(60_000);
    expect(readBotTurnMs({ BOT_TURN_MINUTES: "5" })).toBe(300_000);
    expect(readBotTurnMs({ BOT_TURN_MINUTES: "10" })).toBe(600_000);
  });

  it("rejects anything else, naming only the variable", () => {
    for (const value of ["0", "11", "05", "1.5", "-1", " 5", "60"]) {
      expect(() => readBotTurnMs({ BOT_TURN_MINUTES: value })).toThrow(
        "Invalid env BOT_TURN_MINUTES: expected whole minutes from 1 to 10",
      );
    }
  });
});
