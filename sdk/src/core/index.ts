/**
 * Core iCKB cells, scripts, and UDT completion helpers.
 *
 * @packageDocumentation
 */

export {
  OwnerCell,
  WithdrawalGroup,
  ickbDepositCellFrom,
  type IckbDepositCell,
  type ReceiptCell,
} from "./cells.ts";
export { DaoManager } from "./dao.ts";
export type {
  DaoCellFromCache,
  DaoCellFromOptions,
  DaoDepositCell,
  DaoWithdrawalRequestCell,
} from "./dao_cells.ts";
export {
  DAO_HEADER_INDEX_LIMIT,
  DAO_OUTPUT_LIMIT,
  DaoHeaderIndexError,
  DaoOutputLimitError,
  DaoOutputLimitIndeterminateError,
  assertDaoOutputLimit,
} from "./dao_output_limit.ts";
export {
  OwnerData,
  ReceiptData,
  type OwnerDataLike,
  type ReceiptDataLike,
} from "./entities.ts";
export { LogicManager, receiptPhase2Capacity } from "./logic.ts";
export { OwnedOwnerManager } from "./owned_owner.ts";
export {
  ICKB_DEPOSIT_CAP,
  IckbUdt,
  convert,
  ickbAccountingRatio,
  ickbExchangeRatio,
} from "./udt.ts";
