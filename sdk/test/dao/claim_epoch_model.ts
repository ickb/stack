import { ccc } from "@ckb-ccc/core";
import { headerLike } from "@ickb/testkit";
import { describe, expect, it } from "vitest";

type EpochTuple = [bigint, bigint, bigint];

// Reference model transcribed from deployed dao.c (ckb-system-scripts f25c5ae,
// calculate_dao_input_capacity): held epochs use the strict withdraw_fraction >
// deposit_fraction comparison, lock epochs round up to whole 180-epoch cycles, and the
// claim epoch keeps the deposit's fraction. The stack uses CCC's `calcDaoClaimEpoch` (the
// equality roll of ckb-ccc issue 514 is fixed in the pinned release); this suite pins the
// installed CCC against the deployed script on every run (decisions amendment 52(an)).
function daocMinimalSince(
  [dn, di, dl]: EpochTuple,
  [wn, wi, wl]: EpochTuple,
): EpochTuple {
  let depositedEpochs = wn - dn;
  if (wi * dl > di * wl) {
    depositedEpochs += 1n;
  }
  const lockEpochs = ((depositedEpochs + 179n) / 180n) * 180n;
  return [dn + lockEpochs, di, dl];
}

const LENGTHS = [1n, 3n, 7n, 1800n];
const OFFSETS = [0n, 1n, 179n, 180n, 359n, 360n, 361n, 540n];
const STARTS = [0n, 1n, 2n, 3n];

function* depositWithdrawCases(): Generator<[EpochTuple, EpochTuple]> {
  for (const dl of LENGTHS) {
    for (const wl of LENGTHS) {
      yield* fractionCases(dl, wl);
    }
  }
}

function* fractionCases(dl: bigint, wl: bigint): Generator<[EpochTuple, EpochTuple]> {
  for (const di of new Set([0n, 1n % dl, dl / 2n, dl - 1n])) {
    for (const wi of new Set([0n, 1n % wl, wl / 2n, wl - 1n])) {
      yield* offsetCases([di, dl], [wi, wl]);
    }
  }
}

function* offsetCases(
  [di, dl]: [bigint, bigint],
  [wi, wl]: [bigint, bigint],
): Generator<[EpochTuple, EpochTuple]> {
  for (const dn of STARTS) {
    for (const offset of OFFSETS) {
      // The withdraw block cannot precede the deposit block.
      if (offset === 0n && wi * dl <= di * wl) {
        continue;
      }
      yield [
        [dn, di, dl],
        [dn + offset, wi, wl],
      ];
    }
  }
}

// Adopted from the fable5 audit: the claim epoch is what the deployed script computes.
describe("calcDaoClaimEpoch versus the deployed dao.c model", () => {
  it("matches dao.c minimal since over epoch-length, offset, and fraction combinations", () => {
    let checked = 0;
    for (const [dep, wit] of depositWithdrawCases()) {
      checked += 1;
      const expected = daocMinimalSince(dep, wit);
      const got = ccc.calcDaoClaimEpoch(
        headerLike({ epoch: dep }),
        headerLike({ epoch: wit }),
      );
      const gotScaled = got.integer * got.denominator + got.numerator;
      const expectedScaled = expected[0] * expected[2] + expected[1];
      expect(gotScaled * expected[2]).toBe(expectedScaled * got.denominator);
    }
    expect(checked).toBeGreaterThan(3000);
  });
});
