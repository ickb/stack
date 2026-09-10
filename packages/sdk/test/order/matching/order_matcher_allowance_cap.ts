import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { Info } from "../../../src/order/model/info.ts";
import { Ratio } from "../../../src/order/model/ratio.ts";
import { OrderManager } from "../../../src/order/order.ts";
import {
  makeUdtToCkbOrder,
  resolvedOrderGroup,
  resolvedOrderGroups,
} from "./support/order_match_helpers.ts";
import { makeOrderCell } from "./support/order_order_helpers.ts";

const CKB = ccc.fixedPointFrom(1);
const EXCHANGE_RATE = { ckbScale: 1n, udtScale: 100n };
// A CKB-rich, iCKB-poor bot: buyer (ckb-to-udt) orders are unservable.
const ALLOWANCE = { ckbValue: 1_000_000n, udtValue: 0n };

function buyerOrder(
  byte: string,
  masterByte: string,
): ReturnType<typeof resolvedOrderGroup> {
  return resolvedOrderGroup(
    makeOrderCell({
      ckbUnoccupied: 1000n,
      udtValue: 0n,
      info: Info.from({
        ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
        udtToCkb: Ratio.empty(),
        ckbMinMatchLog: 0,
      }),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte(masterByte), index: 1n },
      },
      outPoint: { txHash: byte32FromByte(byte), index: 0n },
    }),
  );
}

// Adopted from the fable5 policy audit (decisions amendment 52): before the cap, a book of
// unservable buyers generated a state per allowance step each and burned the budget on
// nothing the bot could fund. Each direction is now capped at the allowance plus the other
// direction's supply, so with no sellers there is nothing to generate.
describe("bestMatch allowance cap", () => {
  it("generates no buyer states when neither the allowance nor a seller can fund them", () => {
    const pool = [buyerOrder("c1", "d1"), buyerOrder("c2", "d2"), buyerOrder("c3", "d3")];

    const result = OrderManager.bestMatch(pool, ALLOWANCE, EXCHANGE_RATE, {
      feeRate: 0n,
      ckbAllowanceStep: 1n,
      candidateBudget: 2000,
    });

    expect(result.kind).toBe("complete");
    expect(result.match.partials).toHaveLength(0);
    // The frontier keeps only its empty root: no order contributed a state.
    expect(result.match.diagnostics?.generatedStates.ckbToUdt).toBe(1);
  });

  it("lets a seller's supply fund buyer states beyond the bot's own allowance", () => {
    const pool = [
      buyerOrder("c1", "d1"),
      resolvedOrderGroup(
        makeUdtToCkbOrder({
          udtValue: 1_000_000n,
          orderTxHashByte: "b1",
          txHashByte: "b2",
        }),
      ),
    ];

    const result = OrderManager.bestMatch(pool, ALLOWANCE, EXCHANGE_RATE, {
      feeRate: 0n,
      ckbAllowanceStep: 1n,
      candidateBudget: 2000,
    });

    expect(result.match.diagnostics?.generatedStates.ckbToUdt).toBeGreaterThan(1);
    expect(result.match.partials.length).toBeGreaterThan(0);
  });
});

// A seller asking `udtScale/ckbScale` CKB per iCKB; below one is a premium for the bot at par.
function seller(
  byte: string,
  udtValue: bigint,
  ckbScale: bigint,
  udtScale: bigint,
): ReturnType<typeof makeOrderCell> {
  return makeOrderCell({
    ckbUnoccupied: 0n,
    udtValue,
    info: Info.from({
      ckbToUdt: Ratio.empty(),
      udtToCkb: Ratio.from({ ckbScale, udtScale }),
      ckbMinMatchLog: 0,
    }),
    master: { type: "absolute", value: { txHash: byte32FromByte("33"), index: 1n } },
    outPoint: { txHash: byte32FromByte(byte), index: 0n },
  });
}

// Adopted from the fable51 policy audit as documentation of accepted behaviour: an attacker
// who parks capital in many small better-priced orders pays fees every turn to keep a larger
// order unvisited; the bot never stalls on it, it just serves the dust first.
describe("bestMatch dust ordering", () => {
  it("serves profitable dust at a better price before a larger order the budget never reaches", () => {
    const dust = Array.from({ length: 60 }, (_, index) =>
      seller((index + 16).toString(16), CKB / 100n, 100n, 95n),
    );
    const real = seller("f0", 1_000n * CKB, 100n, 99n);

    const result = OrderManager.bestMatch(
      resolvedOrderGroups([...dust, real]),
      { ckbValue: 100_000n * CKB, udtValue: 100_000n * CKB },
      { ckbScale: 1n, udtScale: 1n },
      {
        feeRate: 1_000n,
        ckbAllowanceStep: 1000n * CKB,
        maxPartials: 58,
        candidateBudget: 5000,
      },
    );

    expect(result.kind).toBe("incomplete");
    expect(result.match.partials.length).toBeGreaterThan(0);
    expect(
      result.match.partials.some(
        ({ group }) => group.order.cell.outPoint.txHash === real.cell.outPoint.txHash,
      ),
    ).toBe(false);
  });
});
