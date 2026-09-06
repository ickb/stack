import { ccc } from "@ckb-ccc/core";
import { endlessCellPageClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { DaoManager } from "../../src/dao/index.ts";
import {
  defaultCellPageSize,
  defaultScanItemLimit,
  PagedScanBudgetError,
} from "../../src/utils/index.ts";
import { collect, headerLike, script } from "./support/dao_support.ts";

/** Pages a full 6,400-item budget spends, plus the page that overflows it. */
const exhaustingPageCount = defaultScanItemLimit / defaultCellPageSize + 1;

describe("DaoManager bounded scans", () => {
  it("stops a deposit scan at the default item budget", async () => {
    const manager = new DaoManager(script("11"), []);
    const scan = endlessCellScan();
    const deposits = collect(
      manager.findDeposits(scan.client, [script("22")], {
        onChain: true,
        tip: headerLike(3n),
      }),
    );

    await expect(deposits).rejects.toBeInstanceOf(PagedScanBudgetError);
    await expect(deposits).rejects.toMatchObject({
      reason: "items",
      items: defaultScanItemLimit,
    });
    expect(scan.pages()).toBe(exhaustingPageCount);
  });

  it("stops a withdrawal request scan at the default item budget", async () => {
    const manager = new DaoManager(script("11"), []);
    const scan = endlessCellScan();
    const withdrawals = collect(
      manager.findWithdrawalRequests(scan.client, [script("22")], {
        onChain: true,
        tip: headerLike(3n),
      }),
    );

    await expect(withdrawals).rejects.toBeInstanceOf(PagedScanBudgetError);
    await expect(withdrawals).rejects.toMatchObject({
      reason: "items",
      items: defaultScanItemLimit,
    });
    expect(scan.pages()).toBe(exhaustingPageCount);
  });
});

function endlessCellScan(): ReturnType<typeof endlessCellPageClient> {
  return endlessCellPageClient(
    ccc.Cell.from({
      outPoint: { txHash: script("81").codeHash, index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(100), lock: script("22") },
      outputData: "0x",
    }),
  );
}
