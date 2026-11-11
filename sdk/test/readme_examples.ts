// The code in sdk/README.md, kept here so the gate typechecks it and runs what needs no
// node. The README shows the same code with `@ickb/sdk` as the import.
import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { projectState } from "../src/conversion/projection.ts";
import { ickb } from "../src/index.ts";
import { makeOrderGroup } from "./conversion/planning/support/sdk_order_support.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
  withdrawalValue,
} from "./conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import {
  baseTip,
  headerLike,
  state as sampledState,
} from "./transaction/base/support/sdk_core_support.ts";

// README: Setup
export function setup(): ccc.Client {
  // A bigger cache than the CCC default: a pool and a book span more blocks than it holds.
  return ccc.ClientPublicTestnet.open({
    cache: new ccc.ClientCacheMemory(...ickb.CACHE_SIZES),
  }).value;
}

// README: Convert
export async function convert(
  signer: ccc.Signer,
  direction: ickb.ConversionDirection,
  amount: bigint,
): Promise<ccc.Hex> {
  const state = await ickb.readState(signer);
  const built = await ickb.buildConversionTransaction(signer, state, direction, amount);
  if (!built.ok) {
    throw new Error(`Cannot convert: ${built.reason}`);
  }
  // Pass the whole result: it carries the fee limit and, for withdrawals, the deadline.
  const sent = await ickb.signAndSendTransaction(signer, built);
  if (!sent.ok && sent.reason !== "maybe-sent") {
    throw new Error(`Not sent: ${sent.reason}`, { cause: sent });
  }
  // Sent, or maybe: a lost answer may still have reached the node, so watch the hash.
  const done = await ickb.waitTransaction(signer.client, sent.txHash);
  if (!done.ok) {
    throw new Error(`Not confirmed: ${done.reason}`, { cause: done });
  }
  return sent.txHash;
}

// README: Max
export function maxAmount(
  state: ickb.State,
  direction: ickb.ConversionDirection,
): bigint {
  return direction === "ckb-to-ickb" ? state.ckbConvertible : state.ickbConvertible;
}

// README: History
export async function recentConversions(
  signer: ccc.Signer,
  count: number,
): Promise<ickb.HistoryEntry[]> {
  const entries: ickb.HistoryEntry[] = [];
  for await (const entry of ickb.readHistory(signer)) {
    entries.push(entry);
    if (entries.length === count) {
      break; // no more pages are read
    }
  }
  return entries;
}

// README: Positions
export function pendingDates(
  state: ickb.State,
): Array<{ createdAt: bigint; readyAt: bigint }> {
  return [...state.pendingOrders, ...state.pendingWithdrawals].map((position) =>
    ickb.datesOf(state, position),
  );
}

describe("README examples", () => {
  it("sets up a client with the larger cache", () => {
    expect(setup().cache).toBeInstanceOf(ccc.ClientCacheMemory);
  });

  it("offers the SDK bound as Max, and dates each pending position", () => {
    const lock = script("11");
    // A sell the bot fills whole stays pending, dated at its estimate.
    const order = makeOrderGroup({
      ownerLock: lock,
      txHashByte: "71",
      ratio: { ckbScale: 2n, udtScale: 1n },
      isCkb2Udt: false,
      udtValue: 10n ** 10n,
    }).group;
    const withdrawal = withdrawalValue({
      ckbValue: 1n,
      isReady: false,
      maturityUnix: 5000n,
    });
    const state = projectState(
      sampledState({ tip: headerLike(0n, { timestamp: 1000n }) }),
      {
        capacityCells: [plainCapacityCell(ccc.fixedPointFrom(5000), lock)],
        nativeUdtCells: [nativeUdtCell(ccc.fixedPointFrom(100), { lock })],
        receipts: [],
        withdrawalGroups: [withdrawal],
      },
      [order],
      lock,
    );

    expect(maxAmount(state, "ckb-to-ickb")).toBe(state.ckbConvertible);
    expect(maxAmount(state, "ickb-to-ckb")).toBe(ccc.fixedPointFrom(100));
    expect(pendingDates(state)).toEqual([
      ickb.datesOf(state, order),
      { createdAt: baseTip.timestamp, readyAt: 5000n },
    ]);
  });
});
