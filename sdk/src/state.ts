import type { ccc } from "@ckb-ccc/core";
import { projectState } from "./conversion/projection.ts";
import type { AccountState, State, SystemState } from "./conversion/types.ts";
import { assertFresh, tipMaxAgeMs, WALLET_LOCK_UP, type LockUpPolicy } from "./dao.ts";
import { findDeposits, receiptsFrom } from "./logic.ts";
import type { OrderGroup } from "./order/cells.ts";
import { findOrders } from "./order/order.ts";
import { Ratio } from "./order/ratio.ts";
import { withdrawalGroupsFrom } from "./owned_owner.ts";
import { ckbFromUdt, ICKB_DEPOSIT_CAP, ickbExchangeRatio, isUdt } from "./udt.ts";
import { signerAccountLocks } from "./utils/signer.ts";
import { findCells, isPlainCapacityCell, unique } from "./utils/utils.ts";
import { verifiedClient } from "./utils/verified_client.ts";

/**
 * Reads the signer's whole state: the system at the sampled tip's parent, the account of
 * every lock the signer's addresses hold, its own orders, and the totals a wallet shows and
 * plans with, under the wallet's withdrawal timing rules.
 *
 * @remarks The signer's locks are asked again on every call, so a wallet that adds an
 * address is scanned whole at the next read. Its recommended lock is the state's
 * `changeLock`, which owns every output a conversion of this state creates.
 */
export async function readState(signer: ccc.Signer): Promise<State> {
  const locks = await signerAccountLocks(signer);
  const { system, userOrders, account } = await readRawState(
    signer.client,
    locks,
    WALLET_LOCK_UP,
  );
  return projectState(system, account, userOrders, locks[0]);
}

/**
 * Reads system, user-order, and account state at the sampled tip's parent, under the
 * caller's withdrawal timing rules (`BOT_LOCK_UP` or `WALLET_LOCK_UP`) and, when given, a
 * positive fee rate cap that replaces CCC's ceiling.
 *
 * @remarks Every read goes through `verifiedClient` and the tip's parent is bounded by the
 * policy's slack, so a caller passes a plain client. Every read is complete and uncapped: a large
 * book or pool costs a slower read, never a partial or failed one. Each account lock is
 * enumerated by one uncached unfiltered exact-lock scan and classified client-side.
 */
export async function readRawState(
  plainClient: ccc.Client,
  locks: ccc.Script[],
  lockUp: LockUpPolicy,
  maxFeeRate?: ccc.NumLike,
): Promise<{
  system: SystemState;
  userOrders: OrderGroup[];
  account: AccountState;
}> {
  const client = verifiedClient(plainClient);
  const live = await client.getTipHeader();
  // The live tip can still lose a one-block race, and a transaction naming it as a header
  // dep is then refused after signing; every recorded fork was one block deep.
  const tip = await client.getHeaderByNumber(live.number - 1n);
  if (tip?.hash !== live.parentHash) {
    throw new Error(
      `Block ${String(live.number - 1n)} is not the parent of tip ${live.hash}`,
    );
  }
  // The age bound is on the header the read is priced at: a fresh tip a node invented can
  // name any old block as its parent.
  assertFresh(tip, tipMaxAgeMs(lockUp));
  const exchangeRatio = Ratio.from(ickbExchangeRatio(tip));
  const [poolDeposits, orders, feeRate, accounts] = await Promise.all([
    findDeposits(client, tip),
    findOrders(client),
    // CCC clamps the sampled median at the cap, the connector's chosen rate too. A given cap
    // replaces CCC's default ceiling, on purpose: the caller's cap is the ceiling; an absent
    // one leaves that default.
    client.getFeeRate(undefined, { maxFeeRate }),
    Promise.all([...unique(locks)].map(async (lock) => readLockCells(client, lock, tip))),
  ]);
  return {
    system: {
      feeRate,
      tip,
      exchangeRatio,
      depositCapacity: ckbFromUdt(ICKB_DEPOSIT_CAP, exchangeRatio),
      // One book, two filters: the market side is every order
      // past par, the wallet's own included, since the bot fills by price, not by owner.
      orderBook: orders.filter((group) => isPastPar(group, exchangeRatio)),
      poolDeposits,
      lockUp,
    },
    userOrders: orders.filter((group) => group.isOwner(...locks)),
    account: {
      capacityCells: accounts.flatMap((account) => account.capacityCells),
      nativeUdtCells: accounts.flatMap((account) => account.nativeUdtCells),
      receipts: accounts.flatMap((account) => account.receipts),
      withdrawalGroups: accounts.flatMap((account) => account.withdrawalGroups),
    },
  };
}

/** Every Stack cell one lock owns, classified from a single exact-lock scan. */
async function readLockCells(
  client: ccc.Client,
  lock: ccc.Script,
  tip: ccc.ClientBlockHeader,
): Promise<AccountState> {
  const scanned = await findCells(client, {
    script: lock,
    scriptType: "lock",
    scriptSearchMode: "exact",
    withData: true,
  });
  const cells = scanned.map(({ cell }) => cell);
  const [receipts, withdrawalGroups] = await Promise.all([
    receiptsFrom(client, scanned),
    withdrawalGroupsFrom(client, scanned, tip),
  ]);
  return {
    capacityCells: cells.filter(isPlainCapacityCell),
    nativeUdtCells: cells.filter((cell) => isUdt(cell)),
    receipts,
    withdrawalGroups,
  };
}

/** An order the market can fill at a gain: priced past the DAO ratio on its matchable side. */
function isPastPar(group: OrderGroup, exchangeRatio: Ratio): boolean {
  const { order } = group;
  const { info } = order.data;
  return (
    (order.isCkb2UdtMatchable() && info.ckbToUdt.compare(exchangeRatio) < 0) ||
    (order.isUdt2CkbMatchable() && exchangeRatio.compare(info.udtToCkb) < 0)
  );
}
