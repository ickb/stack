import { ccc } from "@ckb-ccc/core";
import { capacityCell, script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogicManager, OwnedOwnerManager } from "../../../src/core/index.ts";
import { DaoManager } from "../../../src/dao/index.ts";
import { OrderManager } from "../../../src/order/index.ts";
import { IckbError } from "../../../src/sdk.ts";
import {
  defaultCellPageSize,
  defaultScanItemLimit,
  PagedScanBudget,
} from "../../../src/utils/index.ts";
import { baseTip } from "../../transaction/base/support/sdk_core_support.ts";
import {
  defaultL1Sdk,
  FeeRateStubClient,
  l1SdkWithManagers,
  none,
  tipHeaderHandler,
} from "../l1_account/support/sdk_l1_support.ts";
import { L1_STATE_SUITE } from "./support/l1_pool_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The caller-owned reason every cancellation test expects to propagate intact. */
const CANCELLATION_REASON = new Error("preview expired");

/** Pages a full 6,400-item budget spends, plus the page that overflows it. */
const exhaustingPageCount = defaultScanItemLimit / defaultCellPageSize + 1;

describe(`${L1_STATE_SUITE} shared scan budget`, () => {
  registerAggregateExhaustionTests();
  registerSharedBudgetTests();
  registerCancellationTests();
  registerLateCancellationTests();
});

function registerAggregateExhaustionTests(): void {
  it("stops the composed public scan once the shared item budget is spent", async () => {
    const sdk = defaultL1Sdk();
    let depositPages = 0;
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(baseTip),
      findCellsPagedNoCache: async (
        query,
        _order,
        limit,
      ): ReturnType<ccc.Client["findCellsPagedNoCache"]> => {
        await Promise.resolve();
        if (query.filter?.outputData === undefined) {
          return { cells: [], lastCursor: "" };
        }
        depositPages += 1;
        return {
          cells: Array.from({ length: Number(ccc.numFrom(limit ?? 0)) }, () =>
            capacityCell(ccc.fixedPointFrom(100), script("71"), "81"),
          ),
          lastCursor: `deposit:${String(depositPages)}`,
        };
      },
    });

    const state = sdk.getL1State(client, []);

    await expect(state).rejects.toBeInstanceOf(IckbError);
    await expect(state).rejects.toMatchObject({
      code: "account_scan_limit",
      retryable: false,
    });
    expect(depositPages).toBe(exhaustingPageCount);
  });
}

function registerSharedBudgetTests(): void {
  it("shares one budget across pool, order, and bot withdrawal scans", async () => {
    const { sdk, logicManager, ownedOwnerManager, orderManager } = botSdk();
    const findDeposits = vi
      .spyOn(logicManager, "findDeposits")
      .mockImplementation(() => none());
    const findOrders = vi
      .spyOn(orderManager, "findOrders")
      .mockImplementation(() => none());
    const findWithdrawalGroups = vi
      .spyOn(ownedOwnerManager, "findWithdrawalGroups")
      .mockImplementation(() => none());

    await sdk.getL1State(emptyScanClient(), []);

    const budget = findDeposits.mock.calls[0]?.[1]?.budget;
    expect(budget).toBeInstanceOf(PagedScanBudget);
    expect(findOrders.mock.calls[0]?.[1]?.budget).toBe(budget);
    expect(findWithdrawalGroups.mock.calls[0]?.[2]?.budget).toBe(budget);
  });

  it("shares one budget across system and account scans", async () => {
    const { sdk, logicManager, ownedOwnerManager, orderManager } = botSdk();
    const findDeposits = vi
      .spyOn(logicManager, "findDeposits")
      .mockImplementation(() => none());
    const findReceipts = vi
      .spyOn(logicManager, "findReceipts")
      .mockImplementation(() => none());
    vi.spyOn(orderManager, "findOrders").mockImplementation(() => none());
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());

    await sdk.getL1AccountState(emptyScanClient(), [script("71")]);

    const budget = findDeposits.mock.calls[0]?.[1]?.budget;
    expect(budget).toBeInstanceOf(PagedScanBudget);
    expect(findReceipts.mock.calls[0]?.[2]?.budget).toBe(budget);
  });
}

function registerCancellationTests(): void {
  it("cancels the whole composed scan with the exact state signal reason", async () => {
    const findCellsPagedNoCache = vi.fn();
    const getTipHeader = vi.fn(tipHeaderHandler(baseTip));
    const client = new FeeRateStubClient({
      getTipHeader,
      findCellsPagedNoCache,
    });

    const state = defaultL1Sdk().getL1State(client, [script("71")], {
      signal: abortedSignal(),
    });

    await expect(state).rejects.toBe(CANCELLATION_REASON);
    expect(getTipHeader).not.toHaveBeenCalled();
    expect(findCellsPagedNoCache).not.toHaveBeenCalled();
  });

  it("returns the composed state while its signal stays live", async () => {
    const controller = new AbortController();
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(baseTip),
      findCellsPagedNoCache: emptyPage,
    });

    const { system } = await defaultL1Sdk().getL1State(client, [script("71")], {
      signal: controller.signal,
    });

    expect(system.tip).toBe(baseTip);
  });

  it("cancels a scan that aborted while it was still starting", async () => {
    const controller = new AbortController();
    const findCellsPagedNoCache = vi.fn(
      async (): ReturnType<ccc.Client["findCellsPagedNoCache"]> => {
        // Aborting before the scan first yields, then never settling, is the one
        // window in which no watcher of this signal exists yet.
        controller.abort(CANCELLATION_REASON);
        return new Promise<never>(() => {
          // Deliberately empty: a cancelled client request never settles.
        });
      },
    );
    const client = new FeeRateStubClient({ findCellsPagedNoCache });

    const deposits = defaultL1Sdk().getPoolDeposits(client, baseTip, {
      signal: controller.signal,
    });

    await expect(deposits).rejects.toBe(CANCELLATION_REASON);
    expect(findCellsPagedNoCache).toHaveBeenCalledTimes(1);
  });

  it("cancels a direct pool deposit scan with its own signal reason", async () => {
    const findCellsPagedNoCache = vi.fn();
    const client = new FeeRateStubClient({ findCellsPagedNoCache });

    const deposits = defaultL1Sdk().getPoolDeposits(client, baseTip, {
      signal: abortedSignal(),
    });

    await expect(deposits).rejects.toBe(CANCELLATION_REASON);
    expect(findCellsPagedNoCache).not.toHaveBeenCalled();
  });
}

function registerLateCancellationTests(): void {
  it("cancels an unresolved tip read that no page budget observes", async () => {
    const pendingTip = Promise.withResolvers<ccc.ClientBlockHeader>();
    const controller = new AbortController();
    const getTipHeader = vi.fn(async (): ReturnType<ccc.Client["getTipHeader"]> => {
      return pendingTip.promise;
    });
    const client = new FeeRateStubClient({
      getTipHeader,
      findCellsPagedNoCache: emptyPage,
    });

    const state = defaultL1Sdk().getL1State(client, [script("71")], {
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(getTipHeader).toHaveBeenCalledTimes(1);
    });
    controller.abort(CANCELLATION_REASON);

    await expect(state).rejects.toBe(CANCELLATION_REASON);
    pendingTip.resolve(baseTip);
  });

  it("cancels after the last page instead of returning the scanned state", async () => {
    const totalPages = await countScanPages();
    const controller = new AbortController();
    const pagingDone = Promise.withResolvers<undefined>();
    let pages = 0;
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(baseTip),
      findCellsPagedNoCache: async (): ReturnType<
        ccc.Client["findCellsPagedNoCache"]
      > => {
        pages += 1;
        if (pages === totalPages) {
          // A macrotask lets the last page finish charging the shared budget.
          setTimeout(() => {
            pagingDone.resolve(undefined);
          }, 0);
        }
        return emptyPage();
      },
    });
    // No budget check remains once every page is spent, so only an end-of-scan
    // check can honour an abort raised here.
    vi.spyOn(client, "getFeeRate").mockImplementation(async () => {
      await pagingDone.promise;
      controller.abort(CANCELLATION_REASON);
      return 1n;
    });

    const state = defaultL1Sdk().getL1State(client, [script("71")], {
      signal: controller.signal,
    });

    await expect(state).rejects.toBe(CANCELLATION_REASON);
  });
}

/** Counts the page requests one uncancelled composed public scan spends. */
async function countScanPages(): Promise<number> {
  let pages = 0;
  const client = new FeeRateStubClient({
    getTipHeader: tipHeaderHandler(baseTip),
    findCellsPagedNoCache: async (): ReturnType<ccc.Client["findCellsPagedNoCache"]> => {
      pages += 1;
      return emptyPage();
    },
  });

  await defaultL1Sdk().getL1State(client, [script("71")]);

  return pages;
}

async function emptyPage(): ReturnType<ccc.Client["findCellsPagedNoCache"]> {
  await Promise.resolve();
  return { cells: [], lastCursor: "" };
}

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort(CANCELLATION_REASON);
  return controller.signal;
}

function botSdk(): {
  sdk: ReturnType<typeof l1SdkWithManagers>;
  logicManager: LogicManager;
  ownedOwnerManager: OwnedOwnerManager;
  orderManager: OrderManager;
} {
  const dao = script("33");
  const logicManager = new LogicManager(script("22"), [], new DaoManager(dao, []));
  const ownedOwnerManager = new OwnedOwnerManager(
    script("44"),
    [],
    new DaoManager(dao, []),
  );
  const orderManager = new OrderManager(script("55"), [], script("66"));
  const sdk = l1SdkWithManagers({
    botLock: script("11"),
    logicManager,
    ownedOwnerManager,
    orderManager,
  });
  return { sdk, logicManager, ownedOwnerManager, orderManager };
}

function emptyScanClient(): FeeRateStubClient {
  return new FeeRateStubClient({
    getTipHeader: tipHeaderHandler(baseTip),
    findCellsPagedNoCache: async (): ReturnType<ccc.Client["findCellsPagedNoCache"]> => {
      await Promise.resolve();
      return { cells: [], lastCursor: "" };
    },
  });
}
