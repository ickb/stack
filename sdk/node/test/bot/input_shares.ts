import { describe, expect, it } from "vitest";
import {
  MAX_COLLECTED_ORDERS,
  MAX_OFFERED_ICKB_CELLS,
  MAX_OFFERED_PLAIN_CELLS,
  MAX_OFFERED_RECEIPTS,
} from "../../../src/conversion/projection.ts";
import { DAO_HEADER_INDEX_LIMIT, DAO_OUTPUT_LIMIT } from "../../../src/dao.ts";
import { MAX_MATCH_PARTIALS } from "../../src/bot/match.ts";

describe("one transaction's inputs", () => {
  it("fit the iCKB xUDT script's 2,048, the shares and a plan's own inputs together", () => {
    const shares =
      2 * MAX_COLLECTED_ORDERS + // order and master
      2 * DAO_HEADER_INDEX_LIMIT + // request and owner
      MAX_OFFERED_RECEIPTS +
      MAX_OFFERED_ICKB_CELLS +
      MAX_OFFERED_PLAIN_CELLS;
    // A plan's own: the withdrawn pool deposits (fitWithdrawalDeposits) and the bot's matches.
    const plan = DAO_OUTPUT_LIMIT / 2 + MAX_MATCH_PARTIALS;

    // c/xudt_rce.c's MAX_LOCK_SCRIPT_HASH_COUNT; a raised share or a new source fails here.
    expect(shares + plan).toBeLessThanOrEqual(2048);
  });
});
