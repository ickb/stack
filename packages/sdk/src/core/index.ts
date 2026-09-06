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
