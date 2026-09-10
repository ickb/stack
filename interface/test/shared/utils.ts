import { describe, expect, it } from "vitest";
import {
  direction2Symbol,
  errorMessageOf,
  hasTransactionActivity,
  maxShannons,
  parseAmountInput,
  symbol2Direction,
  toText,
} from "../../src/shared/utils.ts";
import { transactionWith } from "./fixtures/transaction.ts";

describe("amount utilities", () => {
  it("maps display symbols", () => {
    expect(symbol2Direction("I")).toBe(false);
    expect(symbol2Direction("C")).toBe(true);
    expect(direction2Symbol(true)).toBe("C");
    expect(direction2Symbol(false)).toBe("I");
  });

  it("trims fixed-point decimal text", () => {
    expect(toText(123450000n)).toBe("1.2345");
    expect(toText(100000000n)).toBe("1");
  });

  it.each([
    ["", 0n],
    ["0", 0n],
    [".25", 25_000_000n],
    ["1.", 100_000_000n],
    ["1.23456789", 123_456_789n],
    ["184467440737.09551615", maxShannons],
  ])("parses exact fixed-point input %j", (text, amount) => {
    expect(parseAmountInput(text)).toEqual({ status: "valid", amount, error: "" });
  });

  it.each(["-1", "1e2", "1..2", "1.234567899", "abc"])(
    "rejects invalid input %j without rewriting it",
    (text) => {
      expect(parseAmountInput(text)).toMatchObject({
        status: "invalid",
        amount: undefined,
        error: "Enter a decimal amount with up to 8 decimal places",
      });
    },
  );

  it("keeps editing intermediates distinct and rejects overflow", () => {
    expect(parseAmountInput(".")).toEqual({
      status: "intermediate",
      amount: undefined,
      error: "",
    });
    expect(parseAmountInput("184467440737.09551616")).toEqual({
      status: "invalid",
      amount: undefined,
      error: "Amount exceeds the supported maximum",
    });
  });
});

describe("errorMessageOf", () => {
  it("normalizes thrown and primitive errors for UI display", () => {
    expect(errorMessageOf(new Error("boom"))).toBe("boom");
    expect(errorMessageOf("plain failure")).toBe("plain failure");
    expect(errorMessageOf(7)).toBe("7");
    expect(errorMessageOf(true)).toBe("true");
    expect(errorMessageOf(3n)).toBe("3");
    expect(errorMessageOf(undefined)).toBe("Unknown error");
  });

  it("stringifies object errors when possible", () => {
    expect(errorMessageOf({ reason: "bad" })).toBe('{"reason":"bad"}');
  });

  it("falls back when object errors cannot be stringified", () => {
    const error: Record<string, unknown> = {};
    error["self"] = error;

    expect(errorMessageOf(error)).toBe("Unknown error");
  });
});

describe("hasTransactionActivity", () => {
  it("detects transactions with inputs or outputs", () => {
    expect(hasTransactionActivity(transactionWith(0, 0))).toBe(false);
    expect(hasTransactionActivity(transactionWith(1, 0))).toBe(true);
    expect(hasTransactionActivity(transactionWith(0, 1))).toBe(true);
  });
});
