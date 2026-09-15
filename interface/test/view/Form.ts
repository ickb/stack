import { Ratio } from "@ickb/sdk";
import { describe, expect, it } from "vitest";
import { CKB } from "../../src/shared/utils.ts";
import { amountQuoteText, formAssets } from "../../src/view/formState.ts";

describe("amountQuoteText", () => {
  it("shows zero output for empty or zero input without waiting for a quote", () => {
    expect(amountQuoteText(0n, "C", undefined)).toBe("0");
    expect(amountQuoteText(0n, "C0", undefined)).toBe("0");
  });

  it("shows pending output when non-zero input has no quote", () => {
    expect(amountQuoteText(1n, "C0.00000001", undefined)).toBe("...");
  });

  it("distinguishes an editing intermediate from invalid input", () => {
    expect(amountQuoteText(undefined, "C.", undefined)).toBe("...");
    expect(amountQuoteText(undefined, "C1e2", undefined, "Invalid amount")).toBe(
      "Invalid amount",
    );
  });

  it("uses live quote state for non-zero input", () => {
    expect(
      amountQuoteText(2n * CKB, "C2", {
        exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      }),
    ).toBe("1.9998");
  });
});

describe("formAssets", () => {
  it("does not show order-held funds as available", () => {
    const [source, target] = formAssets(
      {
        ckbNative: 1000n * CKB,
        ickbNative: 0n,
        ckbAvailable: 1000n * CKB,
        ickbAvailable: 350n * CKB,
        ckbBalance: 1000n * CKB,
        ickbBalance: 350n * CKB,
      },
      false,
    );

    expect(source).toMatchObject({ name: "iCKB", available: 0n, locked: 350n * CKB });
    expect(target).toMatchObject({ name: "CKB", available: 1000n * CKB });
  });

  it("keeps native iCKB selectable because spending it releases cell capacity", () => {
    const [source] = formAssets(
      {
        ckbNative: 0n,
        ickbNative: 2n * CKB,
        ckbAvailable: 0n,
        ickbAvailable: 2n * CKB,
        ckbBalance: 0n,
        ickbBalance: 2n * CKB,
      },
      false,
    );

    expect(source).toMatchObject({ name: "iCKB", available: 2n * CKB });
  });

  it("reports wallet maturity status for native, available, and pending balances", () => {
    expect(
      formAssets(
        {
          ckbNative: 5n,
          ickbNative: 1n,
          ckbAvailable: 4n,
          ickbAvailable: 1n,
          ckbBalance: 6n,
          ickbBalance: 1n,
        },
        true,
      ),
    ).toMatchObject([
      { name: "CKB", status: "maturing" },
      { name: "iCKB", status: "locked" },
    ]);
    expect(
      formAssets(
        {
          ckbNative: 4n,
          ickbNative: 1n,
          ckbAvailable: 5n,
          ickbAvailable: 1n,
          ckbBalance: 5n,
          ickbBalance: 1n,
        },
        true,
      )[0],
    ).toMatchObject({ name: "CKB", status: "collectable" });
  });

  it("returns bare asset labels until balances load", () => {
    expect(formAssets(undefined, true)).toEqual([{ name: "CKB" }, { name: "iCKB" }]);
  });
});
