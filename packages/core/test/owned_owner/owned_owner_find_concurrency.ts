import { ccc } from "@ckb-ccc/core";
import { DaoManager } from "@ickb/dao";
import { collect } from "@ickb/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnedOwnerManager } from "../../src/owned_owner.ts";
import {
  FIND_WITHDRAWAL_GROUPS_SUITE,
  headerLike,
  ownedWithdrawalCell,
  ownerMarkerCell,
  script,
  StubClient,
  transactionWithHeader,
  type TransactionWithHeader,
  twoOwnerPendingPair,
  twoOwnerWithdrawalFixture,
} from "./support/owned_owner_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(FIND_WITHDRAWAL_GROUPS_SUITE, () => {
  registerReferencedCellConcurrencyTests();
  registerWithdrawalDecodeConcurrencyTests();
  registerHeaderDeduplicationTests();
  registerCrossLockCacheTests();
});

function registerReferencedCellConcurrencyTests(): void {
  it("fetches referenced owned cells concurrently and yields in owner scan order", async () => {
    const fixture = twoOwnerWithdrawalFixture();
    const { manager, ownerLock, tip, firstOwner, secondOwner, firstOwned, secondOwned } =
      fixture;
    const { promise: firstFetch, resolve: resolveFirst } = Promise.withResolvers<
      ccc.Cell | undefined
    >();
    const { promise: secondFetch, resolve: resolveSecond } = Promise.withResolvers<
      ccc.Cell | undefined
    >();
    const pending = new Map([
      [firstOwned.outPoint.toHex(), firstFetch],
      [secondOwned.outPoint.toHex(), secondFetch],
    ]);
    const fetches: ccc.OutPoint[] = [];
    const client = new StubClient({
      getTipHeader: async (): ReturnType<ccc.Client["getTipHeader"]> => {
        await Promise.resolve();
        return tip;
      },
      async *findCells(): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        yield firstOwner;
        yield secondOwner;
      },
      getCell: async (outPoint): ReturnType<ccc.Client["getCell"]> => {
        const normalized = ccc.OutPoint.from(outPoint);
        fetches.push(normalized);
        const fetch = pending.get(normalized.toHex());
        if (fetch === undefined) {
          throw new Error("Unexpected getCell out point");
        }
        return fetch;
      },
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        await Promise.resolve();
        return fixture.depositHeader;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return transactionWithHeader(fixture.withdrawalHeader);
      },
    });

    const groupsPromise = collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    await vi.waitFor(() => {
      expect(fetches).toHaveLength(2);
    });
    expect(fetches.map((outPoint) => outPoint.toHex())).toEqual([
      firstOwned.outPoint.toHex(),
      secondOwned.outPoint.toHex(),
    ]);
    resolveSecond(secondOwned);
    await Promise.resolve();
    resolveFirst(firstOwned);

    const groups = await groupsPromise;

    expect(groups.map((group) => group.owner.cell.outPoint.toHex())).toEqual([
      firstOwner.outPoint.toHex(),
      secondOwner.outPoint.toHex(),
    ]);
  });
}

function registerWithdrawalDecodeConcurrencyTests(): void {
  it("decodes referenced withdrawals concurrently and yields in owner scan order", async () => {
    const fixture = twoOwnerWithdrawalFixture();
    const { manager, ownerLock, tip, firstOwner, secondOwner, firstOwned, secondOwned } =
      fixture;
    const referencedCells = new Map([
      [firstOwned.outPoint.toHex(), firstOwned],
      [secondOwned.outPoint.toHex(), secondOwned],
    ]);
    const headerRequests: ccc.Hex[] = [];
    const {
      first: firstWithdrawalFetch,
      second: secondWithdrawalFetch,
      resolveFirst,
      resolveSecond,
    } = twoOwnerPendingPair<TransactionWithHeader>();
    const client = twoOwnerScanClient({
      tip,
      firstOwner,
      secondOwner,
      referencedCells,
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        await Promise.resolve();
        return fixture.depositHeader;
      },
      getTransactionWithHeader: async (
        txHash,
      ): ReturnType<ccc.Client["getTransactionWithHeader"]> => {
        const hash = ccc.hexFrom(txHash);
        headerRequests.push(hash);
        return hash === firstOwned.outPoint.txHash
          ? firstWithdrawalFetch
          : secondWithdrawalFetch;
      },
    });

    const groupsPromise = collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    await vi.waitFor(() => {
      expect(headerRequests).toEqual([
        firstOwned.outPoint.txHash,
        secondOwned.outPoint.txHash,
      ]);
    });
    resolveSecond(transactionWithHeader(fixture.withdrawalHeader));
    await Promise.resolve();
    resolveFirst(transactionWithHeader(fixture.withdrawalHeader));

    const groups = await groupsPromise;

    expect(groups.map((group) => group.owner.cell.outPoint.toHex())).toEqual([
      firstOwner.outPoint.toHex(),
      secondOwner.outPoint.toHex(),
    ]);
  });
}

function registerHeaderDeduplicationTests(): void {
  it("deduplicates referenced withdrawal header lookups during a scan", async () => {
    const ownerLock = script("11");
    const fixture = headerDeduplicationFixture(ownerLock, ownerLock);
    const client = twoOwnerScanClient(fixture);

    const groups = await collect(
      fixture.manager.findWithdrawalGroups(client, [ownerLock], { tip: fixture.tip }),
    );

    expect(groups).toHaveLength(2);
    expect(fixture.calls).toEqual({ header: 1, transaction: 1 });
  });
}

function registerCrossLockCacheTests(): void {
  it("reuses withdrawal header lookups across requested locks", async () => {
    const firstLock = script("11");
    const secondLock = script("12");
    const fixture = headerDeduplicationFixture(firstLock, secondLock);
    const client = new StubClient({
      async *findCells(query): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        const lock = ccc.Script.from(query.script);
        yield lock.eq(firstLock) ? fixture.firstOwner : fixture.secondOwner;
      },
      getCell: async (outPoint): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        return fixture.referencedCells.get(ccc.OutPoint.from(outPoint).toHex());
      },
      getHeaderByNumber: fixture.getHeaderByNumber,
      getTransactionWithHeader: fixture.getTransactionWithHeader,
    });

    const groups = await collect(
      fixture.manager.findWithdrawalGroups(client, [firstLock, secondLock], {
        tip: fixture.tip,
      }),
    );

    expect(groups).toHaveLength(2);
    expect(fixture.calls).toEqual({ header: 1, transaction: 1 });
  });
}

interface HeaderDeduplicationFixture {
  calls: { header: number; transaction: number };
  firstOwner: ccc.Cell;
  getHeaderByNumber: ccc.Client["getHeaderByNumber"];
  getTransactionWithHeader: ccc.Client["getTransactionWithHeader"];
  manager: OwnedOwnerManager;
  referencedCells: Map<string, ccc.Cell>;
  secondOwner: ccc.Cell;
  tip: ccc.ClientBlockHeader;
}

// Two owners in one transaction share one deposit header, so a scan should read it once.
function headerDeduplicationFixture(
  firstLock: ccc.Script,
  secondLock: ccc.Script,
): HeaderDeduplicationFixture {
  const ownedOwnerScript = script("22");
  const daoScript = script("33");
  const calls = { header: 0, transaction: 0 };
  return {
    calls,
    firstOwner: ownerMarkerCell("88", 1n, firstLock, ownedOwnerScript),
    secondOwner: ownerMarkerCell("88", 3n, secondLock, ownedOwnerScript),
    referencedCells: new Map(
      [0n, 2n].map((index) => {
        const cell = ownedWithdrawalCell({
          txHashByte: "88",
          index,
          ownedOwnerScript,
          daoScript,
          depositHeaderNumber: 1n,
        });
        return [cell.outPoint.toHex(), cell];
      }),
    ),
    manager: new OwnedOwnerManager(ownedOwnerScript, [], new DaoManager(daoScript, [])),
    tip: headerLike(),
    getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
      calls.header += 1;
      await Promise.resolve();
      return headerLike({ number: 1n });
    },
    getTransactionWithHeader: async (): ReturnType<
      ccc.Client["getTransactionWithHeader"]
    > => {
      calls.transaction += 1;
      await Promise.resolve();
      return transactionWithHeader(headerLike({ number: 2n }));
    },
  };
}

function twoOwnerScanClient(options: {
  tip: ccc.ClientBlockHeader;
  firstOwner: ccc.Cell;
  secondOwner: ccc.Cell;
  referencedCells: Map<string, ccc.Cell>;
  getHeaderByNumber: ccc.Client["getHeaderByNumber"];
  getTransactionWithHeader: ccc.Client["getTransactionWithHeader"];
}): ccc.Client {
  return new StubClient({
    getTipHeader: async (): ReturnType<ccc.Client["getTipHeader"]> => {
      await Promise.resolve();
      return options.tip;
    },
    async *findCells(): ReturnType<ccc.Client["findCells"]> {
      await Promise.resolve();
      yield options.firstOwner;
      yield options.secondOwner;
    },
    getCell: async (outPoint): ReturnType<ccc.Client["getCell"]> => {
      await Promise.resolve();
      return options.referencedCells.get(ccc.OutPoint.from(outPoint).toHex());
    },
    getHeaderByNumber: options.getHeaderByNumber,
    getTransactionWithHeader: options.getTransactionWithHeader,
  });
}
