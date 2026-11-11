import { script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { maturity } from "../../../src/conversion/maturity.ts";
import { readyAt } from "../../../src/conversion/projection.ts";
import { makeOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";
import {
  receiptValue,
  withdrawalValue,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { headerLike, state } from "../../transaction/base/support/sdk_core_support.ts";

describe("readyAt", () => {
  const sampled = state({ tip: headerLike(0n, { timestamp: 1000n }) });
  const sell = (
    byte: string,
    ckbScale: bigint,
    udtScale: bigint,
  ): ReturnType<typeof makeOrderGroup>["group"] =>
    makeOrderGroup({
      ownerLock: script("11"),
      txHashByte: byte,
      ratio: { ckbScale, udtScale },
      isCkb2Udt: false,
      udtValue: 10n ** 10n,
    }).group;

  it("dates an order the bot fills at its estimate, and one it refuses now", () => {
    const fillable = sell("71", 2n, 1n);

    expect(readyAt(fillable, sampled)).toBe(maturity(fillable.order, sampled));
    expect(readyAt(fillable, sampled)).toBeGreaterThan(1000n);
    // The next transaction collects a refused order, so it is ready at once.
    expect(readyAt(sell("72", 1n, 2n), sampled)).toBe(0n);
  });

  it("dates a withdrawal at its claim and a receipt now", () => {
    expect(
      readyAt(
        withdrawalValue({ ckbValue: 1n, isReady: false, maturityUnix: 5000n }),
        sampled,
      ),
    ).toBe(5000n);
    expect(readyAt(receiptValue(1n, 1n), sampled)).toBe(0n);
  });
});
