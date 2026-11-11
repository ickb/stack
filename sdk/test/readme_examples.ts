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
  headerLike,
  state as sampledState,
} from "./transaction/base/support/sdk_core_support.ts";

// README: Setup
export function setup(): { client: ccc.Client; sdk: ickb.IckbSdk } {
  // A bigger cache than the CCC default: a pool and a book span more blocks than it holds.
  const client = ccc.ClientPublicTestnet.open({
    cache: new ccc.ClientCacheMemory(...ickb.CACHE_SIZES),
  }).value;
  const sdk = new ickb.IckbSdk();
  return { client, sdk };
}

// README: Convert
export async function convert(
  sdk: ickb.IckbSdk,
  signer: ccc.Signer,
  direction: ickb.ConversionDirection,
  amount: bigint,
): Promise<ccc.Hex> {
  const state = await ickb.readState(signer);
  const built = await sdk.buildConversionTransaction({
    direction,
    amount,
    signer,
    state,
  });
  if (!built.ok) {
    throw new Error(`Cannot convert: ${built.reason}`);
  }
  // Pass the whole result: it carries the fee limit and, for withdrawals, the deadline.
  const txHash = await ickb.signAndSendTransaction(signer, built);
  await ickb.waitTransaction(signer.client, txHash);
  return txHash;
}

// README: Max
export function maxAmount(
  state: ickb.State,
  direction: ickb.ConversionDirection,
): bigint {
  return direction === "ckb-to-ickb" ? state.ckbConvertible : state.ickbAvailable;
}

// README: Positions
export function pendingDates(state: ickb.State): bigint[] {
  return [...state.pendingOrders, ...state.pendingWithdrawals].map((position) =>
    ickb.readyAt(position, state),
  );
}

// README: Errors
export async function convertAndRecover(
  sdk: ickb.IckbSdk,
  signer: ccc.Signer,
  direction: ickb.ConversionDirection,
  amount: bigint,
): Promise<ccc.Hex | undefined> {
  try {
    return await convert(sdk, signer, direction, amount);
  } catch (error) {
    if (error instanceof ickb.TransactionBroadcastError) {
      // The answer got lost, but the node may have it: watch the same hash, don't resend.
      await ickb.waitTransaction(signer.client, error.txHash);
      return error.txHash;
    }
    if (
      error instanceof ickb.TransactionExpiredError ||
      error instanceof ickb.TransactionWaitError
    ) {
      // Too close to a claim, or refused for good: nothing was spent, build it again.
      return undefined;
    }
    throw error;
  }
}

describe("README examples", () => {
  it("sets up a client with the larger cache and the testnet SDK", () => {
    const { client, sdk } = setup();

    expect(client.cache).toBeInstanceOf(ccc.ClientCacheMemory);
    expect(typeof sdk.buildConversionTransaction).toBe("function");
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
    expect(pendingDates(state)).toEqual([ickb.readyAt(order, state), 5000n]);
  });
});
