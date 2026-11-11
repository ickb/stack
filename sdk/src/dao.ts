import { ccc } from "@ckb-ccc/core";
import { DAO } from "./constants.ts";

/**
 * Maximum outputs accepted by deployed dao.c, not a general CKB consensus cap.
 * A node upgrade cannot lift a limit in that deployed script.
 */
export const DAO_OUTPUT_LIMIT = 64;

/**
 * Deposit-header indices the deployed DAO script can address in a phase-2 witness.
 *
 * @remarks The script reads one byte of the u64 field (RFC 0023 erratum,
 * nervosnetwork/rfcs pull 456).
 */
export const DAO_HEADER_INDEX_LIMIT = 256;

/**
 * Whether a transaction using the DAO script has more outputs than the deployed script
 * accepts. An oversized transaction with an unresolved input counts too: whether it uses the
 * DAO cannot be known, and the completion walk steps a plan down either way.
 */
export function exceedsDaoOutputLimit(txLike: ccc.TransactionLike): boolean {
  const tx = ccc.Transaction.from(txLike);
  return (
    tx.outputs.length > DAO_OUTPUT_LIMIT &&
    (tx.inputs.some(
      (input) =>
        input.cellOutput === undefined || input.cellOutput.type?.eq(DAO) === true,
    ) ||
      tx.outputs.some((output) => output.type?.eq(DAO) === true))
  );
}

/** The canonical DAO deposit data payload: a zero Uint64, eight zero bytes. */
export const DAO_DEPOSIT_DATA: ccc.Hex = "0x0000000000000000";

/** Whether the cell is a DAO deposit of the given DAO script. */
export function isDaoDeposit(cell: ccc.CellAny, daoScript: ccc.Script): boolean {
  return (
    cell.outputData === DAO_DEPOSIT_DATA && cell.cellOutput.type?.eq(daoScript) === true
  );
}

/**
 * Whether the cell uses the DAO script and is not deposit-shaped. This structural check
 * does not decode the withdrawal request's deposit block number payload.
 */
export function isDaoWithdrawalRequest(
  cell: ccc.CellAny,
  daoScript: ccc.Script,
): boolean {
  return (
    cell.outputData !== DAO_DEPOSIT_DATA && cell.cellOutput.type?.eq(daoScript) === true
  );
}

/**
 * A caller's timing rules for withdrawal requests, in epochs (the chain's clock, so no
 * wall-clock drift). Selection: a deposit may be requested when its claim epoch is past
 * `tip + minLockUp` (closer, the request would commit after the claim and lock for another
 * cycle, so the deposit is judged on its next cycle) and before `tip + maxLockUp`.
 * Broadcast: the signed request is sent only while the tip is before the earliest selected
 * claim less `broadcastReserve`, else it is refused before broadcast.
 *
 * Every preset keeps `0 < broadcastReserve < minLockUp < maxLockUp`, with `minLockUp` under
 * one DAO cycle: a reserve of zero would send up to the claim itself, a reserve at or past
 * the margin leaves no fresh tip, a maximum at or below the margin selects nothing, and so
 * does a margin of a cycle, since every claim lies within one. Only the two presets below
 * reach the read, so their unit test pins it rather than a check on every read.
 */
export interface LockUpPolicy {
  minLockUp: ccc.Epoch;
  maxLockUp: ccc.Epoch;
  broadcastReserve: ccc.Epoch;
}

/**
 * The bot's rules on the nominal four-hour epoch: claims twenty minutes to an hour out,
 * sent while fifteen minutes remain. The bot signs at once, so a short window suffices, and
 * the estimate models the pool's supply on it (`sdk/docs/pool_maturity_estimates.md`).
 */
export const BOT_LOCK_UP: LockUpPolicy = {
  minLockUp: ccc.Epoch.from([0n, 1n, 12n]),
  maxLockUp: ccc.Epoch.from([0n, 4n, 16n]),
  broadcastReserve: ccc.Epoch.from([0n, 1n, 16n]),
};

/**
 * A wallet's rules on the nominal four-hour epoch: claims two hours to seven days out,
 * sent while ninety minutes remain. A user may leave the request in a wallet popup.
 *
 * @remarks Seven days, raised from three: of 896 mainnet DAO withdrawals in the 158 days
 * to 2026-11-04, 49% were requested within 3 days of their claim, 67% within 7 and 78%
 * within 14 (https://talk.nervos.org/t/11125, post 1, version 3).
 */
export const WALLET_LOCK_UP: LockUpPolicy = {
  minLockUp: ccc.Epoch.from([0n, 1n, 2n]),
  maxLockUp: ccc.Epoch.from([42n, 0n, 1n]),
  broadcastReserve: ccc.Epoch.from([0n, 3n, 8n]),
};

/**
 * How far a tip may trail the local clock under a policy: the selection margin less the
 * broadcast reserve, the slack a stale tip would eat before a request commits after its
 * claim. Five minutes for the bot, thirty for a wallet.
 */
export function tipMaxAgeMs(policy: LockUpPolicy): number {
  // The span from the reserve to the margin, on CCC's nominal four-hour epoch.
  return Number(
    policy.minLockUp.toUnix({ epoch: policy.broadcastReserve, timestamp: 0n }),
  );
}

/** Throws when `header` trails the local clock by more than `maxAgeMs`. */
export function assertFresh(header: ccc.ClientBlockHeader, maxAgeMs: number): void {
  if (BigInt(Date.now()) - header.timestamp > BigInt(maxAgeMs)) {
    throw new Error(`Block ${header.hash} is more than ${String(maxAgeMs)} ms old`);
  }
}

/** A deposit's maturity, rolled a cycle when its claim is too close, and whether it is ready. */
export function depositMaturity(
  claim: ccc.Epoch,
  tip: ccc.ClientBlockHeader,
  { minLockUp, maxLockUp }: LockUpPolicy,
): { maturity: ccc.Epoch; isReady: boolean } {
  const cycle = ccc.Epoch.OneNervosDaoCycle;
  const maturity =
    claim.compare(minLockUp.add(tip.epoch)) <= 0 ? claim.add(cycle) : claim;
  // Every claim lies within a cycle of the tip (CCC's calcDaoClaimEpoch), so a window past
  // one cycle adds nothing but a rolled claim, whose deadline, the unrolled claim less the
  // reserve, has already passed: the send would refuse every plan that selected it.
  const max = maxLockUp.compare(cycle) > 0 ? cycle : maxLockUp;
  return { maturity, isReady: max.add(tip.epoch).compare(maturity) > 0 };
}

/**
 * The epoch a transaction requesting these deposits must be broadcast before: the earliest
 * claim less the reserve; undefined when it requests none.
 */
export function broadcastDeadline(
  claims: readonly ccc.Epoch[],
  policy: LockUpPolicy,
): BroadcastDeadline | undefined {
  const earliest = claims.reduce<ccc.Epoch | undefined>(
    (best, claim) => (best === undefined || claim.compare(best) < 0 ? claim : best),
    undefined,
  );
  return earliest === undefined
    ? undefined
    : { epoch: earliest.sub(policy.broadcastReserve), tipMaxAgeMs: tipMaxAgeMs(policy) };
}

/**
 * The epoch a withdrawal request must be broadcast before, and how far the tip read to
 * check it may trail the clock, the policy's slack: a stale tip would pass the check late.
 */
export interface BroadcastDeadline {
  epoch: ccc.Epoch;
  tipMaxAgeMs: number;
}

/** Adds the header dep once. */
export function pushHeaderDep(tx: ccc.Transaction, hash: ccc.Hex): void {
  if (!tx.headerDeps.includes(hash)) {
    tx.headerDeps.push(hash);
  }
}
