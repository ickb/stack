import { script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { maturity } from "../../../src/conversion/maturity.ts";
import { datesOf } from "../../../src/conversion/projection.ts";
import { makeOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";
import {
  receiptValue,
  withdrawalValue,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { headerLike, state } from "../../transaction/base/support/sdk_core_support.ts";

const TIP = headerLike(9n, { timestamp: 1000n });
const MINTED = headerLike(1n, { timestamp: 100n });
const REQUESTED = headerLike(2n, { timestamp: 200n });

/** A sell of 100 iCKB minted at `MINTED`; at 2 CKB per iCKB the bot fills it, at 1:2 not. */
function sell(
  ckbScale: bigint,
  udtScale: bigint,
  options: {
    masterTxHashByte?: string;
    orderTxHashByte?: string;
    udtValue?: bigint;
  } = {},
): ReturnType<typeof makeOrderGroup>["group"] {
  return makeOrderGroup({
    ownerLock: script("11"),
    txHashByte: options.masterTxHashByte ?? "71",
    ratio: { ckbScale, udtScale },
    isCkb2Udt: false,
    udtValue: options.udtValue ?? 10n ** 10n,
    header: MINTED,
    ...(options.orderTxHashByte === undefined
      ? {}
      : { orderTxHashByte: options.orderTxHashByte }),
  }).group;
}

describe("datesOf", () => {
  it("dates each position's creation: the mint, the request, the deposit", () => {
    const fillable = sell(2n, 1n);
    const receipt = {
      ...receiptValue(1n, 1n),
      header: headerLike(3n, { timestamp: 300n }),
    };
    const withdrawal = withdrawalValue({
      ckbValue: 1n,
      isReady: false,
      maturityUnix: 5000n,
      requestHeader: REQUESTED,
    });
    const sampled = state({ tip: TIP, pendingOrders: [fillable] });

    expect(datesOf(sampled, fillable).createdAt).toBe(100n);
    expect(datesOf(sampled, withdrawal).createdAt).toBe(200n);
    expect(datesOf(sampled, receipt)).toEqual({ createdAt: 300n, readyAt: 300n });
  });

  it("dates readiness, never at 0: an estimate, the tip, a claim, the deposit", () => {
    const fillable = sell(2n, 1n);
    const refused = sell(1n, 2n, { masterTxHashByte: "72" });
    const sampled = state({
      tip: TIP,
      pendingOrders: [fillable],
      availableOrders: [refused],
    });
    const claim = (maturityUnix: bigint): bigint =>
      datesOf(sampled, withdrawalValue({ ckbValue: 1n, isReady: false, maturityUnix }))
        .readyAt;

    expect(datesOf(sampled, fillable).readyAt).toBe(maturity(fillable.order, sampled));
    expect(datesOf(sampled, fillable).readyAt).toBeGreaterThan(TIP.timestamp);
    // The next transaction collects a refused order: ready at the tip.
    expect(datesOf(sampled, refused).readyAt).toBe(TIP.timestamp);
    expect(claim(5000n)).toBe(5000n);
    // A matured withdrawal is ready at its claim, already past.
    expect(claim(500n)).toBe(500n);
  });

  it("dates a position from an older read against the newer state", () => {
    const older = sell(2n, 1n);
    // The newer read holds the same order, found by its master, filled out since.
    const filled = sell(2n, 1n, { orderTxHashByte: "75", udtValue: 0n });
    const newer = state({ tip: TIP, availableOrders: [filled] });

    expect(datesOf(newer, older)).toEqual({ createdAt: 100n, readyAt: TIP.timestamp });
    // A refetched copy dates as the state's own does.
    expect(datesOf(state({ tip: TIP, orderBook: [older] }), sell(2n, 1n))).toEqual(
      datesOf(state({ tip: TIP, orderBook: [older] }), older),
    );
  });

  it("dates an order the state no longer holds as ready at its tip", () => {
    expect(datesOf(state({ tip: TIP }), sell(2n, 1n))).toEqual({
      createdAt: 100n,
      readyAt: TIP.timestamp,
    });
  });
});
