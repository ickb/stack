// Self-tests for the contract oracle, derived ONLY from the Rust contract semantics
// (limit_order/src/entry.rs and ickb_logic/src/entry.rs) — never from the TypeScript
// implementation the oracle exists to judge. Expected values are hand-derived from
// the Rust rules and asserted as constants.
import { describe, expect, it } from "vitest";
import {
  AR_0,
  ckbMinMatchFromLog,
  depositToIckb,
  ICKB_SOFT_CAP,
  validateMatch,
  type OracleInfo,
  type OrderState,
} from "../src/contract_oracle.ts";

const invalidMatch = "InvalidMatch";
const decreasingValue = "DecreasingValue";
const attemptToChangeFulfilled = "AttemptToChangeFulfilled";
const insufficientMatch = "InsufficientMatch";

// 1:1 both ways, min match 8 CKB. Concave-safe: 1 * 1 >= 1 * 1 (entry.rs:233).
const both1to1: OracleInfo = {
  ckbToUdt: { ckbMul: 1n, udtMul: 1n },
  udtToCkb: { ckbMul: 1n, udtMul: 1n },
  ckbMinMatch: ckbMinMatchFromLog(3),
};

// The C1 counterexample regime: ckbMul > udtMul, min match 1 << 3 = 8 CKB.
// Concave-safe: 2 * 1 >= 1 * 2 (entry.rs:233).
const c1Regime: OracleInfo = {
  ckbToUdt: { ckbMul: 2n, udtMul: 1n },
  udtToCkb: { ckbMul: 2n, udtMul: 1n },
  ckbMinMatch: ckbMinMatchFromLog(3),
};

/** Builds an {@link OrderState} with fields named to prevent transposition. */
function state(fields: OrderState): OrderState {
  return fields;
}

describe("validateMatch direction determination (entry.rs:91-100)", () => {
  const input = state({ ckb: 1000n, udt: 5n, ckbUnoccupied: 100n });

  it("rejects an unchanged order", () => {
    expect(validateMatch(input, input, both1to1)).toBe(invalidMatch);
  });

  it("rejects both amounts decreasing", () => {
    const output = state({ ckb: 999n, udt: 4n, ckbUnoccupied: 99n });
    expect(validateMatch(input, output, both1to1)).toBe(invalidMatch);
  });

  it("rejects both amounts increasing", () => {
    const output = state({ ckb: 1001n, udt: 6n, ckbUnoccupied: 101n });
    expect(validateMatch(input, output, both1to1)).toBe(invalidMatch);
  });

  it("rejects a ckb2udt-shaped match when ckbToUdt is disabled", () => {
    const u2cOnly: OracleInfo = {
      udtToCkb: { ckbMul: 1n, udtMul: 1n },
      ckbMinMatch: 8n,
    };
    const output = state({ ckb: 992n, udt: 13n, ckbUnoccupied: 92n });
    expect(validateMatch(input, output, u2cOnly)).toBe(invalidMatch);
  });

  it("rejects a udt2ckb-shaped match when udtToCkb is disabled", () => {
    const c2uOnly: OracleInfo = {
      ckbToUdt: { ckbMul: 1n, udtMul: 1n },
      ckbMinMatch: 8n,
    };
    const output = state({ ckb: 1008n, udt: 0n, ckbUnoccupied: 108n });
    expect(validateMatch(input, output, c2uOnly)).toBe(invalidMatch);
  });

  it("routes shrinking ckb with equal udt to the ckb2udt arm", () => {
    // entry.rs:97 matches (Some, true, _, false); the value rule then fails,
    // proving the direction was accepted rather than falling to InvalidMatch.
    const output = state({ ckb: 999n, udt: 5n, ckbUnoccupied: 99n });
    expect(validateMatch(input, output, both1to1)).toBe(decreasingValue);
  });

  it("routes shrinking udt with equal ckb to the udt2ckb arm", () => {
    // entry.rs:98 matches (_, false, Some, true) — equal ckb qualifies as "false".
    const output = state({ ckb: 1000n, udt: 4n, ckbUnoccupied: 100n });
    expect(validateMatch(input, output, both1to1)).toBe(decreasingValue);
  });
});

describe("validateMatch value rule (entry.rs:103-105)", () => {
  const c2uInput = state({ ckb: 1000n, udt: 0n, ckbUnoccupied: 900n });
  const u2cInput = state({ ckb: 1000n, udt: 20n, ckbUnoccupied: 100n });

  it("passes a ckb2udt match preserving value exactly", () => {
    const output = state({ ckb: 992n, udt: 8n, ckbUnoccupied: 892n });
    expect(validateMatch(c2uInput, output, both1to1)).toBe("ok");
  });

  it("rejects a ckb2udt match one shannon-equivalent short", () => {
    const output = state({ ckb: 992n, udt: 7n, ckbUnoccupied: 892n });
    expect(validateMatch(c2uInput, output, both1to1)).toBe(decreasingValue);
  });

  it("passes a ckb2udt match increasing value", () => {
    const output = state({ ckb: 992n, udt: 9n, ckbUnoccupied: 892n });
    expect(validateMatch(c2uInput, output, both1to1)).toBe("ok");
  });

  it("passes a udt2ckb match preserving value exactly", () => {
    const output = state({ ckb: 1012n, udt: 8n, ckbUnoccupied: 112n });
    expect(validateMatch(u2cInput, output, both1to1)).toBe("ok");
  });

  it("rejects a udt2ckb match one shannon short", () => {
    const output = state({ ckb: 1011n, udt: 8n, ckbUnoccupied: 111n });
    expect(validateMatch(u2cInput, output, both1to1)).toBe(decreasingValue);
  });
});

describe("validateMatch fulfilled immutability (entry.rs:111-113, 122-123)", () => {
  it("rejects modifying a fulfilled ckb2udt order", () => {
    const input = state({ ckb: 100n, udt: 50n, ckbUnoccupied: 0n });
    const output = state({ ckb: 98n, udt: 53n, ckbUnoccupied: 0n });
    expect(validateMatch(input, output, both1to1)).toBe(attemptToChangeFulfilled);
  });

  it("checks ckb2udt fulfillment before the minimum match", () => {
    // Delta 1 < 8 would be InsufficientMatch; entry.rs:111 fires first.
    const input = state({ ckb: 100n, udt: 50n, ckbUnoccupied: 0n });
    const output = state({ ckb: 99n, udt: 51n, ckbUnoccupied: 1n });
    expect(validateMatch(input, output, both1to1)).toBe(attemptToChangeFulfilled);
  });

  it("never reaches the udt2ckb fulfilled guard from valid states", () => {
    // With unsigned amounts, i.udt == 0 makes entry.rs:98's "i.udt > o.udt" false,
    // so direction determination rejects first: entry.rs:122 is dead on-chain.
    const input = state({ ckb: 100n, udt: 0n, ckbUnoccupied: 10n });
    const output = state({ ckb: 110n, udt: 0n, ckbUnoccupied: 20n });
    expect(validateMatch(input, output, both1to1)).toBe(invalidMatch);
  });

  it("ports the udt2ckb fulfilled guard verbatim (out-of-domain probe)", () => {
    // Only an out-of-domain negative output UDT can reach entry.rs:122-123;
    // this probe pins that the ported guard sits where the Rust has it.
    const input = state({ ckb: 100n, udt: 0n, ckbUnoccupied: 10n });
    const output = state({ ckb: 101n, udt: -1n, ckbUnoccupied: 11n });
    expect(validateMatch(input, output, both1to1)).toBe(attemptToChangeFulfilled);
  });
});

describe("validateMatch minimum match, ckb2udt (entry.rs:116-117)", () => {
  const input = state({ ckb: 1000n, udt: 0n, ckbUnoccupied: 900n });

  it("rejects the C1 counterexample: 2 CKB moved against min 8", () => {
    // Value-preserving at ratio 2/1 (2000 = 998 * 2 + 4) but i.ckb < o.ckb + 8.
    const output = state({ ckb: 998n, udt: 4n, ckbUnoccupied: 898n });
    expect(validateMatch(input, output, c1Regime)).toBe(insufficientMatch);
  });

  it("passes the correctly-converted C1 minimum: 8 CKB for 16 UDT", () => {
    const output = state({ ckb: 992n, udt: 16n, ckbUnoccupied: 892n });
    expect(validateMatch(input, output, c1Regime)).toBe("ok");
  });

  it("rejects one CKB short of the C1 minimum", () => {
    const output = state({ ckb: 993n, udt: 14n, ckbUnoccupied: 893n });
    expect(validateMatch(input, output, c1Regime)).toBe(insufficientMatch);
  });

  it("measures the plain CKB delta in the mainnet-like regime too", () => {
    // udtMul > ckbMul does not shrink the CKB-side minimum: 7 < 8 still fails.
    const mainnetLike: OracleInfo = {
      ckbToUdt: { ckbMul: 1n, udtMul: 3n },
      ckbMinMatch: 8n,
    };
    const seven = state({ ckb: 993n, udt: 3n, ckbUnoccupied: 93n });
    const eight = state({ ckb: 992n, udt: 3n, ckbUnoccupied: 92n });
    expect(validateMatch(input, seven, mainnetLike)).toBe(insufficientMatch);
    expect(validateMatch(input, eight, mainnetLike)).toBe("ok");
  });

  it("exempts a fulfilled output from the minimum", () => {
    // entry.rs:116 only applies while o.ckb_unoccupied != 0.
    const small = state({ ckb: 100n, udt: 0n, ckbUnoccupied: 8n });
    const output = state({ ckb: 94n, udt: 6n, ckbUnoccupied: 0n });
    expect(validateMatch(small, output, both1to1)).toBe("ok");
  });
});

describe("validateMatch minimum match, udt2ckb (entry.rs:127-128)", () => {
  const input = state({ ckb: 1000n, udt: 10n, ckbUnoccupied: 50n });

  it("converts the minimum through the ratio when udtMul > ckbMul", () => {
    // i.udt * 3 must reach o.udt * 3 + 8 * 1: delta 2 gives 30 < 32, delta 3 passes.
    const info: OracleInfo = {
      udtToCkb: { ckbMul: 1n, udtMul: 3n },
      ckbMinMatch: 8n,
    };
    const two = state({ ckb: 1006n, udt: 8n, ckbUnoccupied: 56n });
    const three = state({ ckb: 1009n, udt: 7n, ckbUnoccupied: 59n });
    expect(validateMatch(input, two, info)).toBe(insufficientMatch);
    expect(validateMatch(input, three, info)).toBe("ok");
  });

  it("converts the minimum through the ratio when ckbMul > udtMul", () => {
    // In the C1 regime the UDT-side minimum is 8 * 2 / 1 = 16 UDT.
    const big = state({ ckb: 1000n, udt: 20n, ckbUnoccupied: 50n });
    const fifteen = state({ ckb: 1015n, udt: 5n, ckbUnoccupied: 65n });
    const sixteen = state({ ckb: 1016n, udt: 4n, ckbUnoccupied: 66n });
    expect(validateMatch(big, fifteen, c1Regime)).toBe(insufficientMatch);
    expect(validateMatch(big, sixteen, c1Regime)).toBe("ok");
  });

  it("bounds the minimum at a realistic AR-derived ratio", () => {
    // ckbMul = AR_0, udtMul = AR_m ~ 1.18e16: minimum is ceil(8 * AR_0 / AR_m) = 7.
    const info: OracleInfo = {
      udtToCkb: { ckbMul: 10_000_000_000_000_000n, udtMul: 11_800_000_000_000_000n },
      ckbMinMatch: 8n,
    };
    const six = state({ ckb: 1008n, udt: 4n, ckbUnoccupied: 58n });
    const seven = state({ ckb: 1009n, udt: 3n, ckbUnoccupied: 59n });
    expect(validateMatch(input, six, info)).toBe(insufficientMatch);
    expect(validateMatch(input, seven, info)).toBe("ok");
  });

  it("exempts a fulfilled output from the minimum", () => {
    // entry.rs:127 only applies while o.udt != 0.
    const small = state({ ckb: 100n, udt: 5n, ckbUnoccupied: 10n });
    const output = state({ ckb: 105n, udt: 0n, ckbUnoccupied: 15n });
    expect(validateMatch(small, output, both1to1)).toBe("ok");
  });
});

describe("ckbMinMatchFromLog (entry.rs:221-224)", () => {
  it("derives 1 << log", () => {
    expect(ckbMinMatchFromLog(0)).toBe(1n);
    expect(ckbMinMatchFromLog(3)).toBe(8n);
    expect(ckbMinMatchFromLog(64)).toBe(18_446_744_073_709_551_616n);
  });

  it("rejects logs outside 0..=64", () => {
    expect(() => ckbMinMatchFromLog(65)).toThrow("InvalidCkbMinMatchLog");
    expect(() => ckbMinMatchFromLog(-1)).toThrow("InvalidCkbMinMatchLog");
  });
});

describe("depositToIckb (ickb_logic entry.rs:71-84)", () => {
  it("pins the Rust constants", () => {
    // utils/src/constants.rs:20 and ickb_logic/src/constants.rs:7.
    expect(AR_0).toBe(10_000_000_000_000_000n);
    expect(ICKB_SOFT_CAP).toBe(10_000_000_000_000n);
  });

  it("is identity at AR_0 below the cap", () => {
    expect(depositToIckb(1_000_000_000_000n, AR_0)).toBe(1_000_000_000_000n);
  });

  it("applies no discount at the exact cap (strict greater-than)", () => {
    expect(depositToIckb(ICKB_SOFT_CAP, AR_0)).toBe(ICKB_SOFT_CAP);
  });

  it("floors the discount just above the cap", () => {
    // Excess 1 and 10 discount by floor(excess / 10) = 0 and 1.
    expect(depositToIckb(ICKB_SOFT_CAP + 1n, AR_0)).toBe(ICKB_SOFT_CAP + 1n);
    expect(depositToIckb(ICKB_SOFT_CAP + 10n, AR_0)).toBe(ICKB_SOFT_CAP + 9n);
  });

  it("discounts the excess by 10%", () => {
    expect(depositToIckb(ICKB_SOFT_CAP + 100n, AR_0)).toBe(ICKB_SOFT_CAP + 90n);
    expect(depositToIckb(2n * ICKB_SOFT_CAP, AR_0)).toBe(19_000_000_000_000n);
  });

  it("floors the conversion at a realistic AR", () => {
    // 1e13 * 1e16 / 1.18e16 = 8474576271186.44..., floored.
    expect(depositToIckb(10_000_000_000_000n, 11_800_000_000_000_000n)).toBe(
      8_474_576_271_186n,
    );
  });

  it("crosses the cap boundary exactly at a realistic AR", () => {
    // 11.8e12 * AR_0 / 1.18e16 == cap exactly; +1 shannon still floors to the
    // cap; +2 lands at cap + 1 with a floor(1 / 10) = 0 discount.
    const ar = 11_800_000_000_000_000n;
    expect(depositToIckb(11_800_000_000_000n, ar)).toBe(ICKB_SOFT_CAP);
    expect(depositToIckb(11_800_000_000_001n, ar)).toBe(ICKB_SOFT_CAP);
    expect(depositToIckb(11_800_000_000_002n, ar)).toBe(ICKB_SOFT_CAP + 1n);
  });

  it("is non-decreasing across the cap kink", () => {
    const pairs: Array<[bigint, bigint]> = [
      [ICKB_SOFT_CAP - 1n, ICKB_SOFT_CAP],
      [ICKB_SOFT_CAP, ICKB_SOFT_CAP + 1n],
      [ICKB_SOFT_CAP + 10n, ICKB_SOFT_CAP + 11n],
      [ICKB_SOFT_CAP + 19n, ICKB_SOFT_CAP + 20n],
    ];
    for (const [smaller, larger] of pairs) {
      expect(depositToIckb(smaller, AR_0)).toBeLessThanOrEqual(
        depositToIckb(larger, AR_0),
      );
      expect(depositToIckb(smaller, 11_800_000_000_000_000n)).toBeLessThanOrEqual(
        depositToIckb(larger, 11_800_000_000_000_000n),
      );
    }
  });
});
