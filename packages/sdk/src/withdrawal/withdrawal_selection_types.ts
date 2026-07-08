import type { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "@ickb/core";

/**
 * Minimal deposit shape accepted by withdrawal selection helpers.
 *
 * @public
 */
export interface WithdrawalDepositCandidate {
  /** Deposit out point used for identity and duplicate filtering. */
  cell: { outPoint: { toHex: () => string } };

  /** Whether the deposit is ready to request withdrawal. */
  isReady: boolean;

  /** iCKB value represented by the deposit. */
  udtValue: bigint;

  /** DAO maturity epoch used for ring and maturity ordering. */
  maturity: ccc.Epoch;
}

/**
 * Selected deposits plus required live anchors for owned-owner withdrawal.
 *
 * @public
 */
export interface ReadyWithdrawalSelection<
  T extends WithdrawalDepositCandidate = IckbDepositCell,
> {
  /** Deposits selected to spend into withdrawal requests. */
  deposits: T[];

  /** Extra deposits to add as live cell deps without spending. */
  requiredLiveDeposits: T[];
}

/**
 * Options for selecting ready deposits for one withdrawal request transaction.
 *
 * @public
 */
export interface ReadyWithdrawalSelectionOptions<
  T extends WithdrawalDepositCandidate = IckbDepositCell,
> {
  /** Ready deposits available for selection. */
  readyDeposits: readonly T[];

  /** Sampled tip used for maturity ordering. */
  tip: ccc.ClientBlockHeader;

  /** Maximum iCKB amount to cover with selected deposits. */
  maxAmount: bigint;

  /** Minimum selected deposit count. Defaults to 1. */
  minCount?: number;

  /** Maximum selected deposit count. */
  maxCount?: number;

  /** Optional predicate for excluding deposits before selection. */
  canSelectDeposit?: (deposit: T) => boolean;

  /** Optional live anchor lookup for selected deposits. */
  requiredLiveDepositFor?: (deposit: T) => T | undefined;
}

export type ScoredReadyWithdrawalSelectionOptions<
  T extends WithdrawalDepositCandidate = IckbDepositCell,
> = ReadyWithdrawalSelectionOptions<T> & {
  score?: (deposit: T) => bigint;
};

export type ExactReadyWithdrawalSelectionOptions<
  T extends WithdrawalDepositCandidate = IckbDepositCell,
> = Omit<ReadyWithdrawalSelectionOptions<T>, "minCount" | "maxCount"> & {
  count: number;
};

export type ScoredExactReadyWithdrawalSelectionOptions<
  T extends WithdrawalDepositCandidate = IckbDepositCell,
> = ExactReadyWithdrawalSelectionOptions<T> & {
  score?: (deposit: T) => bigint;
};
