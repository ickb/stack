import { describe, expect, it } from "vitest";
import { sumUdt } from "../../../src/conversion/projection.ts";
import { projectionReadyDeposit } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";

describe("sdk projection value helpers", () => {
  it("sums the iCKB of deposits", () => {
    expect(
      sumUdt([projectionReadyDeposit(5n, 40n), projectionReadyDeposit(7n, 60n)]),
    ).toBe(12n);
  });
});
