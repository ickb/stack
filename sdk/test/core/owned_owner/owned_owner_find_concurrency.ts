import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnedOwnerManager } from "../../../src/core/owned_owner.ts";
import { DaoManager } from "../../../src/dao/index.ts";
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
  it("fetches referenced owned cells concurrently and keeps owner order", async () => {
    const fixture = twoOwnerWithdrawalFixture();
    const { manager, tip, firstOwner, secondOwner, firstOwned, secondOwned } = fixture;
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

    const groupsPromise = manager.withdrawalGroupsFrom(
      client,
      [firstOwner, secondOwner],
      tip,
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
  it("decodes referenced withdrawals concurrently and keeps owner order", async () => {
    const fixture = twoOwnerWithdrawalFixture();
    const { manager, tip, firstOwner, secondOwner, firstOwned, secondOwned } = fixture;
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
    const client = twoOwnerClient({
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

    const groupsPromise = manager.withdrawalGroupsFrom(
      client,
      [firstOwner, secondOwner],
      tip,
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
  it("reads a deposit header shared by two owners of one batch once", async () => {
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const calls = { header: 0, transaction: 0 };
    // Two owners in one transaction share one deposit header.
    const owners = [
      ownerMarkerCell("88", 1n, script("11"), ownedOwnerScript),
      ownerMarkerCell("88", 3n, script("12"), ownedOwnerScript),
    ];
    const referencedCells = new Map(
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
    );
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const client = twoOwnerClient({
      referencedCells,
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
    });

    const groups = await manager.withdrawalGroupsFrom(client, owners, headerLike());

    expect(groups).toHaveLength(2);
    expect(calls).toEqual({ header: 1, transaction: 1 });
  });
}

function twoOwnerClient(options: {
  referencedCells: Map<string, ccc.Cell>;
  getHeaderByNumber: ccc.Client["getHeaderByNumber"];
  getTransactionWithHeader: ccc.Client["getTransactionWithHeader"];
}): ccc.Client {
  return new StubClient({
    getCell: async (outPoint): ReturnType<ccc.Client["getCell"]> => {
      await Promise.resolve();
      return options.referencedCells.get(ccc.OutPoint.from(outPoint).toHex());
    },
    getHeaderByNumber: options.getHeaderByNumber,
    getTransactionWithHeader: options.getTransactionWithHeader,
  });
}
