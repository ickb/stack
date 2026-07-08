import { ccc } from "@ckb-ccc/core";
import { script, StubClient } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testSdk } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { baseTip, hash } from "../../transaction/base/support/sdk_core_support.ts";
import { none, repeat } from "./support/sdk_l1_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IckbSdk.getAccountState", () => {
  it("uses a custom account cell scan page size", async () => {
    const { sdk, logicManager, ownedOwnerManager } = testSdk();
    const accountLock = script("11");
    const findReceipts = vi
      .spyOn(logicManager, "findReceipts")
      .mockImplementation(() => none());
    const findWithdrawalGroups = vi
      .spyOn(ownedOwnerManager, "findWithdrawalGroups")
      .mockImplementation(() => none());
    const cell = ccc.Cell.from({
      outPoint: { txHash: hash("92"), index: 0n },
      cellOutput: { capacity: 5n, lock: accountLock },
      outputData: "0x",
    });
    const cellPageSize = 1;
    let requestedPageSize = 0;
    const client = new StubClient({
      async *findCellsOnChain(
        _query,
        _order,
        pageSize,
      ): ReturnType<ccc.Client["findCellsOnChain"]> {
        requestedPageSize = pageSize ?? 0;
        yield* repeat(2, cell);
        await Promise.resolve();
      },
    });

    const state = await sdk.getAccountState(client, [accountLock], baseTip, {
      cellPageSize,
    });

    expect(requestedPageSize).toBe(cellPageSize);
    expect(findReceipts.mock.calls[0]?.[2]).toMatchObject({
      pageSize: cellPageSize,
    });
    expect(findWithdrawalGroups.mock.calls[0]?.[2]).toMatchObject({
      pageSize: cellPageSize,
    });
    expect(state.capacityCells).toEqual([cell, cell]);
  });
});
