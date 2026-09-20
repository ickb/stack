import { ccc } from "@ckb-ccc/core";
import { CheckedUint64LE } from "./utils/codec.ts";

/**
 * Maximum output count accepted by the Nervos DAO validator path.
 */
export const DAO_OUTPUT_LIMIT = 64;

/**
 * Deposit-header indices the deployed DAO script can address in a phase-2 witness.
 *
 * @remarks The script reads one byte of the u64 field (RFC 0023 erratum,
 * nervosnetwork/rfcs pull 456).
 */
export const DAO_HEADER_INDEX_LIMIT = 256;

/** One DAO cycle, the lock-up a deposit renews by when it is not withdrawn. */
export const DAO_CYCLE_EPOCHS = 180n;

/**
 * Error thrown when a DAO transaction exceeds the protocol output limit.
 */
export class DaoOutputLimitError extends Error {
  /**
   * Creates an output-limit error for a transaction with too many outputs.
   */
  constructor(outputCount: number, options?: ErrorOptions) {
    super(
      `NervosDAO transaction has ${String(outputCount)} output cells, exceeding the limit of ${String(DAO_OUTPUT_LIMIT)}`,
      options,
    );
    this.name = "DaoOutputLimitError";
  }
}

/**
 * Error thrown when a phase-2 withdrawal would reference a deposit header the
 * deployed DAO script cannot address.
 */
export class DaoHeaderIndexError extends Error {
  /**
   * Creates a header-index error for one unrepresentable index.
   */
  constructor(headerIndex: number, options?: ErrorOptions) {
    super(
      `NervosDAO deposit header index ${String(headerIndex)} is not below ${String(DAO_HEADER_INDEX_LIMIT)}`,
      options,
    );
    this.name = "DaoHeaderIndexError";
  }
}

/**
 * Throws when a transaction using the DAO script exceeds the Nervos DAO output limit. An
 * oversized transaction with an unresolved input is refused too: whether it uses the DAO
 * cannot be known, and the completion walk steps a plan down on this error either way.
 */
export function assertDaoOutputLimit(
  txLike: ccc.TransactionLike,
  daoScriptLike: ccc.ScriptLike,
): void {
  const tx = ccc.Transaction.from(txLike);
  if (tx.outputs.length <= DAO_OUTPUT_LIMIT) {
    return;
  }
  const daoScript = ccc.Script.from(daoScriptLike);
  if (
    tx.inputs.some(
      (input) =>
        input.cellOutput === undefined || input.cellOutput.type?.eq(daoScript) === true,
    ) ||
    tx.outputs.some((output) => output.type?.eq(daoScript) === true)
  ) {
    throw new DaoOutputLimitError(tx.outputs.length);
  }
}

/** The canonical DAO deposit data payload. */
export function depositData(): ccc.Hex {
  return ccc.hexFrom(CheckedUint64LE.encode(0n));
}

/** Whether the cell is a DAO deposit of the given DAO script. */
export function isDaoDeposit(cell: ccc.CellAny, daoScript: ccc.Script): boolean {
  return (
    cell.outputData === depositData() && cell.cellOutput.type?.eq(daoScript) === true
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
    cell.outputData !== depositData() && cell.cellOutput.type?.eq(daoScript) === true
  );
}

/** Matches deployed dao.c at ckb-system-scripts\@f25c5ae: equal fractions do not roll twice. */
export function daoClaimEpoch(
  depositHeader: ccc.ClientBlockHeaderLike,
  withdrawHeader: ccc.ClientBlockHeaderLike,
): ccc.Epoch {
  const deposit = ccc.ClientBlockHeader.from(depositHeader).epoch.normalizeBase();
  const withdraw = ccc.ClientBlockHeader.from(withdrawHeader).epoch.normalizeBase();
  const partialCycle = (withdraw.integer - deposit.integer) % DAO_CYCLE_EPOCHS;
  const depositFractionPrecedesWithdraw =
    deposit.numerator * withdraw.denominator < withdraw.numerator * deposit.denominator;
  const withdrawInteger =
    partialCycle !== 0n || depositFractionPrecedesWithdraw
      ? withdraw.integer - partialCycle + DAO_CYCLE_EPOCHS
      : withdraw.integer;
  return ccc.Epoch.from([withdrawInteger, deposit.numerator, deposit.denominator]);
}

/**
 * A caller's timing rules for withdrawal requests, in epochs (the chain's clock, so no
 * wall-clock drift). Selection: a deposit may be requested when its claim epoch is past
 * `tip + minLockUp` (closer, the request would commit after the claim and lock for another
 * cycle, so the deposit is judged on its next cycle) and before `tip + maxLockUp`.
 * Broadcast: the signed request is sent only while the tip is before the earliest selected
 * claim less `broadcastReserve`, else it is refused and rebuilt (decisions amendment 52(al)).
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
 * A wallet's rules: claims two hours to three days out, sent while ninety minutes remain. A
 * user signs by hand, so the request may sit in a wallet popup for a while (user, 2026-09-20).
 */
export const WALLET_LOCK_UP: LockUpPolicy = {
  minLockUp: ccc.Epoch.from([0n, 1n, 2n]),
  maxLockUp: ccc.Epoch.from([18n, 0n, 1n]),
  broadcastReserve: ccc.Epoch.from([0n, 3n, 8n]),
};

/** A deposit's maturity, rolled a cycle when its claim is too close, and whether it is ready. */
export function depositMaturity(
  claim: ccc.Epoch,
  tip: ccc.ClientBlockHeader,
  { minLockUp, maxLockUp }: LockUpPolicy,
): { maturity: ccc.Epoch; isReady: boolean } {
  const maturity =
    claim.compare(minLockUp.add(tip.epoch)) <= 0
      ? claim.add([DAO_CYCLE_EPOCHS, 0n, 1n])
      : claim;
  return { maturity, isReady: maxLockUp.add(tip.epoch).compare(maturity) > 0 };
}

/**
 * The epoch a transaction requesting these deposits must be broadcast before: the earliest
 * claim less the reserve; undefined when it requests none.
 */
export function broadcastDeadline(
  claims: readonly ccc.Epoch[],
  { broadcastReserve }: LockUpPolicy,
): ccc.Epoch | undefined {
  const earliest = claims.reduce<ccc.Epoch | undefined>(
    (best, claim) => (best === undefined || claim.compare(best) < 0 ? claim : best),
    undefined,
  );
  return earliest?.sub(broadcastReserve);
}

/** Adds the header dep once. */
export function pushHeaderDep(tx: ccc.Transaction, hash: ccc.Hex): void {
  if (!tx.headerDeps.includes(hash)) {
    tx.headerDeps.push(hash);
  }
}
