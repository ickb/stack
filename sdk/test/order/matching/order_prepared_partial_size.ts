import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { partialOrderFee } from "../../../src/order/fee.ts";
import { OrderMatcher, type Match } from "../../../src/order/matcher.ts";
import { OrderManager } from "../../../src/order/order.ts";
import { makeUdtToCkbOrder, resolvedOrderGroup } from "./support/order_match_helpers.ts";

function fullMatch(groups: Array<ReturnType<typeof resolvedOrderGroup>>): Match {
  const match: Match = { ckbDelta: 0n, udtDelta: 0n, partials: [] };
  for (const group of groups) {
    const matcher = OrderMatcher.from(group, false, 0n);
    if (matcher === undefined) {
      throw new Error("expected a matcher");
    }
    const full = matcher.match(matcher.bMaxMatch);
    match.ckbDelta += full.ckbDelta;
    match.udtDelta += full.udtDelta;
    match.partials.push(...full.partials);
  }
  return match;
}

/** Signer preparation pads one empty witness entry per unsigned order input. */
function preparedSize(tx: ccc.Transaction): number {
  const prepared = tx.clone();
  while (prepared.witnesses.length < prepared.inputs.length) {
    prepared.witnesses.push("0x");
  }
  return prepared.toBytes().length;
}

// Adopted from the fable5 audit: the marginal fee the matcher charges each partial is the
// real serialized-size delta of one more prepared partial, not a formula that drifts.
describe("prepared partial serialized size", () => {
  it("equals the measured serialization delta of one additional full partial", () => {
    const first = makeUdtToCkbOrder({ orderTxHashByte: "44", txHashByte: "33" });
    const second = makeUdtToCkbOrder({ orderTxHashByte: "55", txHashByte: "66" });
    const udtScript = first.cell.cellOutput.type;
    if (udtScript === undefined) {
      throw new Error("expected a UDT type script");
    }
    const manager = new OrderManager(first.cell.cellOutput.lock, [], udtScript);
    const one = manager.addMatch(
      ccc.Transaction.default(),
      fullMatch([resolvedOrderGroup(first)]),
    );
    const two = manager.addMatch(
      ccc.Transaction.default(),
      fullMatch([resolvedOrderGroup(first), resolvedOrderGroup(second)]),
    );

    // At one shannon per byte the fee of one more partial is its prepared size.
    expect(BigInt(preparedSize(two) - preparedSize(one))).toBe(
      partialOrderFee([resolvedOrderGroup(first)], 1000n),
    );
  });
});
