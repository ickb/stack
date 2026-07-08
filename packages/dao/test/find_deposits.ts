import { ccc } from "@ckb-ccc/core";
import { describe, expect, it, vi } from "vitest";
import { DaoManager } from "../src/index.ts";
import {
  byte32FromByte,
  collect,
  FIND_DEPOSITS_SUITE,
  headerLike,
  script,
  StubClient,
  transactionWithHeader,
  type TransactionWithHeader,
} from "./support/dao_support.ts";

describe(`${FIND_DEPOSITS_SUITE} scan paging`, () => {
  it("passes the cell page size to deposit scanning", async () => {
    const manager = new DaoManager(script("11"), []);
    const lock = script("22");
    const [firstDeposit, secondDeposit] = depositCells(manager, lock, "33", "44");
    let requestedPageSize = 0;
    const testClient = new StubClient({
      async *findCells(
        _query,
        _order,
        pageSize = 10,
      ): ReturnType<ccc.Client["findCells"]> {
        requestedPageSize = pageSize;
        await Promise.resolve();
        yield firstDeposit;
        yield secondDeposit;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return transactionWithHeader(headerLike(1n));
      },
    });

    const deposits = await collect(
      manager.findDeposits(testClient, [lock], { tip: headerLike(3n), pageSize: 1 }),
    );

    expect(requestedPageSize).toBe(1);
    expect(deposits.map((deposit) => deposit.cell.outPoint.txHash)).toEqual([
      firstDeposit.outPoint.txHash,
      secondDeposit.outPoint.txHash,
    ]);
  });

  it("uses default tip and on-chain scans when requested", async () => {
    const manager = new DaoManager(script("11"), []);
    const lock = script("22");
    const [deposit] = depositCells(manager, lock, "33", "44");
    let tipReads = 0;
    let onChainPageSize = 0;
    const testClient = new StubClient({
      getTipHeader: async (): ReturnType<ccc.Client["getTipHeader"]> => {
        tipReads += 1;
        await Promise.resolve();
        return headerLike(3n);
      },
      async *findCellsOnChain(
        _query,
        _order,
        pageSize = 10,
      ): ReturnType<ccc.Client["findCellsOnChain"]> {
        onChainPageSize = pageSize;
        await Promise.resolve();
        yield deposit;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return transactionWithHeader(headerLike(1n));
      },
    });

    const deposits = await collect(
      manager.findDeposits(testClient, [lock], {
        onChain: true,
        minLockUp: ccc.Epoch.from([0n, 0n, 1n]),
        maxLockUp: ccc.Epoch.from([200n, 0n, 1n]),
      }),
    );

    expect(tipReads).toBe(1);
    expect(onChainPageSize).toBeGreaterThan(1);
    expect(deposits).toHaveLength(1);
  });
});

describe(`${FIND_DEPOSITS_SUITE} concurrent decoding`, () => {
  it("decodes deposits concurrently and yields scan order", async () => {
    const manager = new DaoManager(script("11"), []);
    const lock = script("22");
    const [firstDeposit, secondDeposit] = depositCells(manager, lock, "33", "44");
    const requests: ccc.Hex[] = [];
    const { promise: firstFetch, resolve: resolveFirst } =
      Promise.withResolvers<TransactionWithHeader>();
    const { promise: secondFetch, resolve: resolveSecond } =
      Promise.withResolvers<TransactionWithHeader>();
    const testClient = new StubClient({
      async *findCells(): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        yield firstDeposit;
        yield secondDeposit;
      },
      getTransactionWithHeader: async (
        txHash,
      ): ReturnType<ccc.Client["getTransactionWithHeader"]> => {
        const hash = ccc.hexFrom(txHash);
        requests.push(hash);
        return hash === firstDeposit.outPoint.txHash ? firstFetch : secondFetch;
      },
    });

    const depositsPromise = collect(
      manager.findDeposits(testClient, [lock], { tip: headerLike(3n) }),
    );

    await vi.waitFor(() => {
      expect(requests).toEqual([
        firstDeposit.outPoint.txHash,
        secondDeposit.outPoint.txHash,
      ]);
    });
    resolveSecond(transactionWithHeader(headerLike(1n)));
    await Promise.resolve();
    resolveFirst(transactionWithHeader(headerLike(1n)));

    const deposits = await depositsPromise;

    expect(deposits.map((deposit) => deposit.cell.outPoint.txHash)).toEqual([
      firstDeposit.outPoint.txHash,
      secondDeposit.outPoint.txHash,
    ]);
  });
});

describe(`${FIND_DEPOSITS_SUITE} single-lock cache reuse`, () => {
  it("deduplicates deposit transaction header requests during a scan", async () => {
    const manager = new DaoManager(script("11"), []);
    const lock = script("22");
    const txHash = byte32FromByte("33");
    const firstDeposit = depositCell(manager, lock, txHash, 0n);
    const secondDeposit = depositCell(manager, lock, txHash, 1n);
    let transactionCalls = 0;
    const testClient = new StubClient({
      async *findCells(): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        yield firstDeposit;
        yield secondDeposit;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        transactionCalls += 1;
        await Promise.resolve();
        return transactionWithHeader(headerLike(1n));
      },
    });

    const deposits = await collect(
      manager.findDeposits(testClient, [lock], { tip: headerLike(3n) }),
    );

    expect(transactionCalls).toBe(1);
    expect(deposits).toHaveLength(2);
  });
});

describe(`${FIND_DEPOSITS_SUITE} multi-lock cache reuse`, () => {
  it("reuses deposit transaction header requests across lock scans", async () => {
    const manager = new DaoManager(script("11"), []);
    const firstLock = script("22");
    const secondLock = script("33");
    const txHash = byte32FromByte("44");
    const firstDeposit = depositCell(manager, firstLock, txHash, 0n);
    const secondDeposit = depositCell(manager, secondLock, txHash, 1n);
    let transactionCalls = 0;
    const testClient = new StubClient({
      async *findCells(query): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        yield ccc.Script.from(query.script).eq(firstLock) ? firstDeposit : secondDeposit;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        transactionCalls += 1;
        await Promise.resolve();
        return transactionWithHeader(headerLike(1n));
      },
    });

    const deposits = await collect(
      manager.findDeposits(testClient, [firstLock, secondLock], { tip: headerLike(3n) }),
    );

    expect(transactionCalls).toBe(1);
    expect(deposits.map((deposit) => deposit.cell.outPoint.index)).toEqual([0n, 1n]);
  });
});

function depositCells(
  manager: DaoManager,
  lock: ccc.Script,
  firstByte: string,
  secondByte: string,
): [ccc.Cell, ccc.Cell] {
  return [
    depositCell(manager, lock, byte32FromByte(firstByte), 0n),
    depositCell(manager, lock, byte32FromByte(secondByte), 0n),
  ];
}

function depositCell(
  manager: DaoManager,
  lock: ccc.Script,
  txHash: ccc.Hex,
  index: bigint,
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash, index },
    cellOutput: { capacity: ccc.fixedPointFrom(100082), lock, type: manager.script },
    outputData: DaoManager.depositData(),
  });
}
