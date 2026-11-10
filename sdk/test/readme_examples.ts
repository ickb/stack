// The code in sdk/README.md, kept here so the gate typechecks it and runs what needs no
// node. The README shows the same code with `@ickb/sdk` as the import.
import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { ickb } from "../src/index.ts";
import { makeOrderGroup } from "./conversion/planning/support/sdk_order_support.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
  withdrawalValue,
} from "./conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import {
  headerLike,
  system as sampledSystem,
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

// README: Read the account
export async function readAccount(
  sdk: ickb.IckbSdk,
  signer: ccc.Signer,
): Promise<ickb.ConversionTransactionContextProjection> {
  const locks = await ickb.signerAccountLocks(signer);
  const { system, userOrders, account } = await sdk.getL1AccountState(
    signer.client,
    locks,
    ickb.WALLET_LOCK_UP,
  );
  // Every output a conversion creates belongs to this lock.
  const changeLock = (await signer.getRecommendedAddressObj()).script;
  return ickb.projectConversionTransactionContext(
    system,
    account,
    userOrders,
    changeLock,
  );
}

// README: Convert
export async function convert(
  sdk: ickb.IckbSdk,
  signer: ccc.Signer,
  direction: ickb.ConversionDirection,
  amount: bigint,
): Promise<ccc.Hex> {
  const { context } = await readAccount(sdk, signer);
  const built = await sdk.buildConversionTransaction({
    direction,
    amount,
    signer,
    context,
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
  projection: ickb.AccountAvailabilityProjection,
  direction: ickb.ConversionDirection,
): bigint {
  return direction === "ckb-to-ickb"
    ? projection.ckbConvertible
    : projection.ickbAvailable;
}

// README: Positions
export function pendingDates({
  projection,
  context,
}: ickb.ConversionTransactionContextProjection): bigint[] {
  return [...projection.pendingOrders, ...projection.pendingWithdrawals].map((position) =>
    ickb.readyAt(position, context.system),
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
    const state = ickb.projectConversionTransactionContext(
      sampledSystem({ tip: headerLike(0n, { timestamp: 1000n }) }),
      {
        capacityCells: [plainCapacityCell(ccc.fixedPointFrom(5000), lock)],
        nativeUdtCells: [nativeUdtCell(ccc.fixedPointFrom(100), { lock })],
        receipts: [],
        withdrawalGroups: [withdrawal],
      },
      [order],
      lock,
    );

    expect(maxAmount(state.projection, "ckb-to-ickb")).toBe(
      state.projection.ckbConvertible,
    );
    expect(maxAmount(state.projection, "ickb-to-ckb")).toBe(ccc.fixedPointFrom(100));
    expect(pendingDates(state)).toEqual([
      ickb.readyAt(order, state.context.system),
      5000n,
    ]);
  });
});
