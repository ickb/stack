import type { ccc } from "@ckb-ccc/core";
import { LogicManager, OwnedOwnerManager } from "@ickb/core";
import { DaoManager } from "@ickb/dao";
import { OrderManager } from "@ickb/order";
import { capacityCell, script } from "@ickb/testkit";
import { defaultCellPageSize } from "@ickb/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  FeeRateStubClient,
  L1_STATE_SUITE,
  l1SdkWithManagers,
  none,
  repeat,
  tipHeaderHandler,
} from "./support/sdk_l1_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(L1_STATE_SUITE, () => {
  it("uses one page size for bot capacity and withdrawal scans", async () => {
    await expectSharedPageSizeForCapacityAndWithdrawalScans();
  });

  it("passes one custom page size through L1 state loading", async () => {
    await expectCustomPageSizeThroughL1StateLoading();
  });
});

async function expectSharedPageSizeForCapacityAndWithdrawalScans(): Promise<void> {
  const botLock = script("11");
  const dao = script("33");
  const ownedOwnerManager = new OwnedOwnerManager(
    script("44"),
    [],
    new DaoManager(dao, []),
  );
  const findWithdrawalGroups = vi
    .spyOn(ownedOwnerManager, "findWithdrawalGroups")
    .mockImplementation(() => none());
  const pageSize = defaultCellPageSize + 100;
  const sdk = l1SdkWithManagers({
    botLock,
    ownedOwnerManager,
    orderManager: new OrderManager(script("55"), [], script("66")),
  });
  const plainCell = capacityCell(1n, botLock, "04");
  let requestedPageSize = 0;
  const client = new FeeRateStubClient({
    getTipHeader: tipHeaderHandler(headerLike(1n)),
    async *findCellsOnChain(
      query,
      _order,
      requestPageSize,
    ): ReturnType<ccc.Client["findCellsOnChain"]> {
      if (
        query.filter?.scriptLenRange !== undefined &&
        query.filter.outputDataLenRange !== undefined
      ) {
        requestedPageSize = requestPageSize ?? 0;
        yield* repeat((requestPageSize ?? 0) + 1, plainCell);
      }
      await Promise.resolve();
    },
  });

  await sdk.getL1State(client, [], { cellPageSize: pageSize });
  expect(requestedPageSize).toBe(pageSize);
  expect(findWithdrawalGroups.mock.calls[0]?.[2]).toMatchObject({ pageSize });
}

async function expectCustomPageSizeThroughL1StateLoading(): Promise<void> {
  const botLock = script("11");
  const dao = script("33");
  const logicManager = new LogicManager(script("22"), [], new DaoManager(dao, []));
  const ownedOwnerManager = new OwnedOwnerManager(
    script("44"),
    [],
    new DaoManager(dao, []),
  );
  const orderManager = new OrderManager(script("55"), [], script("66"));
  vi.spyOn(logicManager, "findDeposits").mockImplementation(() => none());
  const findWithdrawalGroups = vi
    .spyOn(ownedOwnerManager, "findWithdrawalGroups")
    .mockImplementation(() => none());
  const findOrders = vi
    .spyOn(orderManager, "findOrders")
    .mockImplementation(() => none());
  const sdk = l1SdkWithManagers({
    botLock,
    logicManager,
    ownedOwnerManager,
    orderManager,
  });
  const plainCell = capacityCell(1n, botLock, "04");
  const cellPageSize = defaultCellPageSize + 1;
  const sampledTip = headerLike(1n);
  const capacityLimits: number[] = [];
  const client = new FeeRateStubClient({
    getTipHeader: tipHeaderHandler(sampledTip),
    async *findCellsOnChain(
      query,
      _order,
      pageSize,
    ): ReturnType<ccc.Client["findCellsOnChain"]> {
      if (
        query.filter?.scriptLenRange !== undefined &&
        query.filter.outputDataLenRange !== undefined
      ) {
        capacityLimits.push(pageSize ?? 0);
        yield* repeat(cellPageSize, plainCell);
      }
      await Promise.resolve();
    },
  });

  await sdk.getL1State(client, [], { cellPageSize });
  expect(capacityLimits).toEqual([cellPageSize]);
  expect(findWithdrawalGroups.mock.calls[0]?.[2]).toMatchObject({
    onChain: true,
    tip: sampledTip,
    pageSize: cellPageSize,
  });
  expect(findOrders.mock.calls[0]?.[1]).toMatchObject({
    onChain: true,
    pageSize: cellPageSize,
  });
}
