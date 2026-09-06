import { ccc } from "@ckb-ccc/core";
import { StubClient } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCellPageSize, PagedScanBudget } from "../../../src/utils/index.ts";
import { testSdk } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { baseTip } from "../../transaction/base/support/sdk_core_support.ts";
import {
  emptyCellScan,
  FeeRateStubClient,
  none,
  tipHeaderHandler,
} from "../l1_account/support/sdk_l1_support.ts";
import { L1_STATE_SUITE } from "./support/l1_pool_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(L1_STATE_SUITE, () => {
  it("uses the default page size when pool scan options are omitted", async () => {
    const { sdk, logicManager } = testSdk();
    const findDeposits = vi
      .spyOn(logicManager, "findDeposits")
      .mockImplementation(() => none());
    const client = new StubClient({ findCellsOnChain: emptyCellScan });

    await sdk.getPoolDeposits(client, baseTip);

    expect(findDeposits.mock.calls[0]?.[0]).toBe(client);
    expect(findDeposits.mock.calls[0]?.[1]).toMatchObject({
      onChain: true,
      tip: baseTip,
      pageSize: defaultCellPageSize,
    });
    expect(findDeposits.mock.calls[0]?.[1]?.budget).toBeInstanceOf(PagedScanBudget);
  });

  it("passes a custom page size to pool deposit scanning", async () => {
    const { sdk, logicManager } = testSdk();
    const findDeposits = vi
      .spyOn(logicManager, "findDeposits")
      .mockImplementation(() => none());
    const client = new StubClient({ findCellsOnChain: emptyCellScan });
    const cellPageSize = defaultCellPageSize + 100;
    const minLockUp = ccc.Epoch.from([0n, 1n, 16n]);
    const maxLockUp = ccc.Epoch.from([0n, 4n, 16n]);

    await sdk.getPoolDeposits(client, baseTip, {
      cellPageSize,
      minLockUp,
      maxLockUp,
    });

    expect(findDeposits.mock.calls[0]?.[1]).toMatchObject({
      onChain: true,
      tip: baseTip,
      pageSize: cellPageSize,
      minLockUp,
      maxLockUp,
    });
  });

  it("passes custom pool deposit scan options through L1 state loading", async () => {
    const { sdk, logicManager } = testSdk();
    const findDeposits = vi
      .spyOn(logicManager, "findDeposits")
      .mockImplementation(() => none());
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(baseTip),
      findCellsOnChain: emptyCellScan,
    });
    const cellPageSize = defaultCellPageSize + 100;
    const minLockUp = ccc.Epoch.from([0n, 1n, 16n]);
    const maxLockUp = ccc.Epoch.from([0n, 4n, 16n]);

    await sdk.getL1State(client, [], {
      cellPageSize,
      poolDeposits: { minLockUp, maxLockUp },
    });

    expect(findDeposits.mock.calls[0]?.[1]).toMatchObject({
      onChain: true,
      tip: baseTip,
      pageSize: cellPageSize,
      minLockUp,
      maxLockUp,
    });
  });
});
