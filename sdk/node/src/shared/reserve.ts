import { ccc } from "@ckb-ccc/core";

/**
 * Plain CKB the bot and the generator keep for their own cells and fees: the bot's sizing
 * line for matches and deposits, the generator's floor under its budget.
 */
export const CKB_RESERVE = ccc.fixedPointFrom(1000);
