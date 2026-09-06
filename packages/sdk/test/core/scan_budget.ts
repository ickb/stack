import { ccc } from "@ckb-ccc/core";
import { endlessCellPageClient, headerLike, script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { LogicManager } from "../../src/core/logic.ts";
import { OwnedOwnerManager } from "../../src/core/owned_owner.ts";
import { DaoManager } from "../../src/dao/index.ts";
import {
  collect,
  defaultCellPageSize,
  defaultScanItemLimit,
  PagedScanBudgetError,
} from "../../src/utils/index.ts";

/** Pages a full 6,400-item budget spends, plus the page that overflows it. */
const exhaustingPageCount = defaultScanItemLimit / defaultCellPageSize + 1;

describe("Core manager bounded scans", () => {
  it("stops a receipt scan at the default item budget", async () => {
    const manager = new LogicManager(script("22"), [], new DaoManager(script("33"), []));
    const scan = endlessCellScan();
    const receipts = collect(
      manager.findReceipts(scan.client, [script("71")], { onChain: true }),
    );

    await expect(receipts).rejects.toBeInstanceOf(PagedScanBudgetError);
    await expect(receipts).rejects.toMatchObject({
      reason: "items",
      items: defaultScanItemLimit,
    });
    expect(scan.pages()).toBe(exhaustingPageCount);
  });

  it("stops a withdrawal group scan at the default item budget", async () => {
    const manager = new OwnedOwnerManager(
      script("44"),
      [],
      new DaoManager(script("33"), []),
    );
    const scan = endlessCellScan();
    const groups = collect(
      manager.findWithdrawalGroups(scan.client, [script("71")], {
        onChain: true,
        tip: headerLike(),
      }),
    );

    await expect(groups).rejects.toBeInstanceOf(PagedScanBudgetError);
    await expect(groups).rejects.toMatchObject({
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
      cellOutput: { capacity: ccc.fixedPointFrom(100), lock: script("71") },
      outputData: "0x",
    }),
  );
}
