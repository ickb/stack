import { Ratio } from "@ickb/sdk";
import { describe, expect, it } from "vitest";
import { figureText, groupDigits, phoneFigureText } from "../../src/shared/figures.ts";
import { CKB, parseAmountInput } from "../../src/shared/utils.ts";
import {
  amountQuoteText,
  caretAfter,
  conversionQuote,
  formAssets,
} from "../../src/view/formState.ts";
import { projection } from "./fixtures/projection.ts";

const unit = Ratio.from({ ckbScale: 1n, udtScale: 1n });

describe("amountQuoteText", () => {
  it("shows zero output for empty or zero input without waiting for a quote", () => {
    expect(amountQuoteText(true, parseAmountInput(""), undefined)).toBe("0");
    expect(amountQuoteText(true, parseAmountInput("0"), undefined)).toBe("0");
  });

  it("shows pending output when non-zero input has no quote", () => {
    expect(amountQuoteText(true, parseAmountInput("0.00000001"), undefined)).toBe("...");
    expect(
      amountQuoteText(
        true,
        parseAmountInput("0.00000001"),
        Ratio.from({ ckbScale: 1n << 80n, udtScale: 1n }),
      ),
    ).toBe("...");
  });

  it("distinguishes an editing intermediate from invalid input", () => {
    expect(amountQuoteText(true, parseAmountInput("."), undefined)).toBe("...");
    expect(amountQuoteText(true, parseAmountInput("1e2"), undefined)).toBe(
      "Enter a decimal amount with up to 8 decimal places",
    );
  });

  it("uses live quote state for non-zero input", () => {
    expect(amountQuoteText(true, parseAmountInput("2"), unit)).toBe("2.00");
    expect(amountQuoteText(false, parseAmountInput("2"), unit)).toBe("2.00");
  });

  it("groups the quoted thousands", () => {
    expect(amountQuoteText(true, parseAmountInput("2000000"), unit)).toBe("1,999,800.00");
  });
});

describe("groupDigits", () => {
  it("groups a typed or quoted decimal and leaves anything else alone", () => {
    expect(groupDigits("")).toBe("");
    expect(groupDigits("999")).toBe("999");
    expect(groupDigits("1234567.12345678")).toBe("1,234,567.12345678");
    expect(groupDigits("1234.")).toBe("1,234.");
    expect(groupDigits(".5")).toBe(".5");
    expect(groupDigits("1e2")).toBe("1e2");
  });

  it("puts the caret back after the same non-comma characters", () => {
    expect(caretAfter("1,234", 1)).toBe(1);
    expect(caretAfter("1,234", 2)).toBe(3);
    expect(caretAfter("1,234,567.5", 7)).toBe(9);
    expect(caretAfter("1,234", 4)).toBe(5);
  });
});

describe("formAssets", () => {
  it("does not show order-held funds as available", () => {
    const [source, target] = formAssets(
      projection({
        ckbNative: 1000n * CKB,
        ickbNative: 0n,
        ckbAvailable: 1000n * CKB,
        ickbAvailable: 350n * CKB,
        ckbBalance: 1000n * CKB,
        ickbBalance: 350n * CKB,
      }),
      false,
    );

    // Max sets the SDK's bound, collectable orders included; CKB has no Max (52(z)).
    expect(source).toMatchObject({
      name: "iCKB",
      balance: { available: 0n, locked: 350n * CKB },
      max: 350n * CKB,
    });
    expect(target).toMatchObject({ name: "CKB", balance: { available: 1000n * CKB } });
    expect(target.max).toBeUndefined();
  });

  it("keeps native iCKB selectable because spending it releases cell capacity", () => {
    const [source] = formAssets(
      projection({
        ckbNative: 0n,
        ickbNative: 2n * CKB,
        ckbAvailable: 0n,
        ickbAvailable: 2n * CKB,
        ckbBalance: 0n,
        ickbBalance: 2n * CKB,
      }),
      false,
    );

    expect(source).toMatchObject({ name: "iCKB", balance: { available: 2n * CKB } });
  });

  it("reports wallet maturity status for native, available, and pending balances", () => {
    expect(
      formAssets(
        projection({
          ckbNative: 5n,
          ickbNative: 1n,
          ckbAvailable: 4n,
          ickbAvailable: 1n,
          ckbBalance: 6n,
          ickbBalance: 1n,
        }),
        true,
      ),
    ).toMatchObject([
      { name: "CKB", balance: { status: "converting" } },
      { name: "iCKB", balance: { status: "converting" } },
    ]);
    expect(
      formAssets(
        projection({
          ckbNative: 4n,
          ickbNative: 1n,
          ckbAvailable: 5n,
          ickbAvailable: 1n,
          ckbBalance: 5n,
          ickbBalance: 1n,
        }),
        true,
      )[0],
    ).toMatchObject({ name: "CKB", balance: { status: "collectable" } });
  });

  it("returns bare asset labels until balances load", () => {
    expect(formAssets(undefined, true)).toEqual([{ name: "CKB" }, { name: "iCKB" }]);
  });
});

describe("balance figures", () => {
  it("groups thousands and keeps every decimal on a wide screen", () => {
    expect(figureText(0n)).toBe("0");
    expect(figureText(1234567n * CKB + 12345678n)).toBe("1,234,567.12345678");
    expect(figureText(100000000000n * CKB)).toBe("100,000,000,000");
  });

  it("shows whole units with a plus on a phone, compact from eight digits", () => {
    expect(phoneFigureText(0n)).toBe("0");
    expect(phoneFigureText(9999999n * CKB + 1n)).toBe("9,999,999+");
    expect(phoneFigureText(12345678n * CKB)).toBe("12.3M");
    expect(phoneFigureText(123456789n * CKB + 1n)).toBe("123M");
    expect(phoneFigureText(1234567890n * CKB)).toBe("1.23G");
    // The chart caption compacts a digit earlier.
    expect(phoneFigureText(999999n * CKB + 1n, 1_000_000n)).toBe("999,999+");
    expect(phoneFigureText(1234567n * CKB, 1_000_000n)).toBe("1.23M");
  });
});

describe("conversionQuote", () => {
  it("quotes both directions net of the default order fee", () => {
    expect(conversionQuote(true, 200000000n, unit)).toBe(199980000n);
    expect(conversionQuote(false, 200000000n, unit)).toBe(199980000n);
  });

  it("returns undefined instead of throwing when a quote cannot be represented", () => {
    expect(
      conversionQuote(true, 1n, Ratio.from({ ckbScale: 1n << 80n, udtScale: 1n })),
    ).toBeUndefined();
  });

  it("rethrows unexpected quote failures", () => {
    expect(() => {
      conversionQuote(true, 100000000n, Ratio.from({ ckbScale: 0n, udtScale: 1n }));
    }).toThrow("Invalid ExchangeRatio");
  });
});
