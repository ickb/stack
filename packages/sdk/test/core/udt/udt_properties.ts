/**
 * Property layer for iCKB conversion math, adjudicated by the contract oracle.
 *
 * Seed discipline: fast-check prints the failing seed and the shrunk
 * counterexample on failure. Set VITEST_FC_SEED=<seed> to replay that exact run,
 * for example `VITEST_FC_SEED=42 pnpm vitest run packages/core`.
 */
import { depositToIckb } from "@ickb/testkit";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { convert, ickbValue } from "../../../src/core/udt.ts";
import { headerLike } from "../cells/support/cells_support.ts";

// This package is browser-safe and loads no node types; declare the one node
// global the seed hook needs instead of widening the package's program.
declare const process: { env: Record<string, string | undefined> };

const seedText = process.env["VITEST_FC_SEED"];
fc.configureGlobal({
  numRuns: 250,
  ...(seedText === undefined ? {} : { seed: Number(seedText) }),
});

const shannonsPerCkb = 10n ** 8n;

/** Standard deposit bounds, 1000 CKB to 1M CKB, in shannons. */
const depositArb = fc.bigInt({
  min: 1000n * shannonsPerCkb,
  max: 1_000_000n * shannonsPerCkb,
});

/** Accumulated rates from genesis AR_0 up to twice AR_0. */
const arArb = fc.bigInt({ min: 10n ** 16n, max: 2n * 10n ** 16n });

const scaleArb = fc.bigInt({ min: 1n, max: 1n << 20n });
const amountArb = fc.bigInt({ min: 0n, max: 10n ** 14n });

describe("udt conversion properties versus contract oracle", () => {
  it("ickbValue equals the oracle deposit_to_ickb across deposits and ARs", () => {
    // The deposit range reaches far above the 100_000 iCKB soft cap, so both the
    // undiscounted and the above-cap 10% discount branches are exercised.
    fc.assert(
      fc.property(depositArb, arArb, (unoccupied, ar) => {
        expect(ickbValue(unoccupied, headerLike(ar))).toBe(depositToIckb(unoccupied, ar));
      }),
    );
  });

  it.each([
    { name: "ckb2udt then back", isCkb2Udt: true },
    { name: "udt2ckb then back", isCkb2Udt: false },
  ])("convert round trip ($name) never gains and loses boundedly", ({ isCkb2Udt }) => {
    fc.assert(
      fc.property(amountArb, scaleArb, scaleArb, (amount, ckbScale, udtScale) => {
        const ratio = { ckbScale, udtScale };
        const across = convert(isCkb2Udt, amount, ratio);
        const back = convert(!isCkb2Udt, across, ratio);
        // Forward floors amount*n/m, the return trip floors again, so the total
        // loss is ceil(r/n) for a remainder r < m: at most ceil((m - 1)/n).
        const [n, m] = isCkb2Udt ? [ckbScale, udtScale] : [udtScale, ckbScale];
        const maxLoss = (m - 1n + n - 1n) / n;
        expect(back).toBeLessThanOrEqual(amount);
        expect(amount - back).toBeLessThanOrEqual(maxLoss);
      }),
    );
  });
});
