import { ccc } from "@ckb-ccc/core";
import { endlessCellPageClient, script } from "@ickb/testkit";
import {
  defaultCellPageSize,
  defaultScanItemLimit,
  PagedScanBudgetError,
} from "@ickb/utils";
import { describe, expect, it } from "vitest";
import { OrderManager } from "../../src/order.ts";
import { ORDER_MANAGER_FIND_ORDERS_SUITE } from "../fixtures/order_constants.ts";
import { collectOrders } from "./support/order_scan_helpers.ts";

/** Pages a full 6,400-item budget spends, plus the page each of the two concurrent scans overflows on. */
const sharedPageCeiling = defaultScanItemLimit / defaultCellPageSize + 2;

describe(`${ORDER_MANAGER_FIND_ORDERS_SUITE} scan budget`, () => {
  it("stops order and master scans at one shared item budget", async () => {
    const manager = new OrderManager(script("55"), [], script("66"));
    const scan = endlessCellPageClient(
      ccc.Cell.from({
        outPoint: { txHash: script("81").codeHash, index: 0n },
        cellOutput: { capacity: ccc.fixedPointFrom(100), lock: script("55") },
        outputData: "0x",
      }),
    );

    const orders = collectOrders(manager, scan.client, { onChain: true });

    await expect(orders).rejects.toBeInstanceOf(PagedScanBudgetError);
    await expect(orders).rejects.toMatchObject({ reason: "items" });
    // Both scans share the item budget, so neither can page on its own ceiling.
    expect(scan.pages()).toBeLessThanOrEqual(sharedPageCeiling);
    expect(scan.pages()).toBeGreaterThan(defaultScanItemLimit / defaultCellPageSize);
  });
});
