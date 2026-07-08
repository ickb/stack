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
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const tip = headerLike();
    const firstOwner = ownerMarkerCell("88", 1n, ownerLock, ownedOwnerScript);
    const secondOwner = ownerMarkerCell("88", 3n, ownerLock, ownedOwnerScript);
    const firstOwned = ownedWithdrawalCell({
      txHashByte: "88",
      index: 0n,
      ownedOwnerScript,
      daoScript,
      depositHeaderNumber: 1n,
    });
    const secondOwned = ownedWithdrawalCell({
      txHashByte: "88",
      index: 2n,
      ownedOwnerScript,
      daoScript,
      depositHeaderNumber: 1n,
    });
    const referencedCells = new Map([
      [firstOwned.outPoint.toHex(), firstOwned],
      [secondOwned.outPoint.toHex(), secondOwned],
    ]);
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    let headerCalls = 0;
    let transactionCalls = 0;
    const client = twoOwnerScanClient({
      tip,
      firstOwner,
      secondOwner,
      referencedCells,
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        headerCalls += 1;
        await Promise.resolve();
        return headerLike({ number: 1n });
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        transactionCalls += 1;
        await Promise.resolve();
        return transactionWithHeader(headerLike({ number: 2n }));
      },
    });

    const groups = await collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    expect(groups).toHaveLength(2);
    expect(headerCalls).toBe(1);
    expect(transactionCalls).toBe(1);
  });
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
