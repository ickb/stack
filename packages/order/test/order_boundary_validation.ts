import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import type { OrderGroup } from "../src/model/cells.ts";
import { Info } from "../src/model/info.ts";
import { Ratio } from "../src/model/ratio.ts";
import { OrderManager } from "../src/order.ts";
import { byte32FromByte } from "./matching/support/order_order_helpers.ts";

const UDT_SCRIPT = script("22");

describe("order transaction boundary validation", () => {
  it("rejects unresolved groups at match and melt boundaries", () => {
    const manager = new OrderManager(script("11"), [], UDT_SCRIPT);
    // Runtime JavaScript callers can bypass the public TypeScript contract.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Deliberately malformed boundary input.
    const unresolved = {} as OrderGroup;

    expect(() =>
      manager.addMatch(ccc.Transaction.default(), {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [{ group: unresolved, ckbOut: 0n, udtOut: 0n }],
      }),
    ).toThrow("Match partial is missing resolved order provenance");
    expect(() => manager.melt(ccc.Transaction.default(), [unresolved])).toThrow(
      "Matching requires resolved OrderGroups from findOrders()",
    );
  });
});

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

function script(byte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(byte),
    hashType: "type",
    args: "0x",
  });
}
