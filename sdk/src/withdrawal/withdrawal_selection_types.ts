import type { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "../core/index.ts";
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

  /** Optional predicate for excluding deposits before selection. */
  canSelectDeposit?: (deposit: T) => boolean;
}
