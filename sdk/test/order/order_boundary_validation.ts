import { describe, expect, it } from "vitest";
import { Info } from "../../src/order/info.ts";
import { Ratio } from "../../src/order/ratio.ts";

describe("order info fallback validation", () => {
  it("rejects ratios that bypass their own classification validation", () => {
    expect(() => {
      Info.from({
        ckbToUdt: new UnvalidatedRatio(1n, 0n),
        udtToCkb: Ratio.empty(),
        ckbMinMatchLog: 0,
      }).validate();
    }).toThrow("udtToCkb is Empty, but ckbToUdt is not Populated");
    expect(() => {
      Info.from({
        ckbToUdt: new UnvalidatedRatio(1n, 0n),
        udtToCkb: new UnvalidatedRatio(0n, 1n),
        ckbMinMatchLog: 0,
      }).validate();
    }).toThrow("One ratio is invalid, so not Empty and not Populated");
  });
});

class UnvalidatedRatio extends Ratio {
  public override validate(): void {
    // Simulates an external subtype that bypasses its nested validator.
  }
}
