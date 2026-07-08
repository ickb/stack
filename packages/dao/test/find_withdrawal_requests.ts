import { ccc } from "@ckb-ccc/core";
import { describe, expect, it, vi } from "vitest";
import { DaoManager } from "../src/index.ts";
import {
  byte32FromByte,
  collect,
  FIND_WITHDRAWAL_REQUESTS_SUITE,
  headerLike,
  script,
  StubClient,
  transactionWithHeader,
  type TransactionWithHeader,
} from "./support/dao_support.ts";

describe(`${FIND_WITHDRAWAL_REQUESTS_SUITE} scan page size`, () => {
  it("passes the cell page size to withdrawal request scanning", async () => {
    const manager = new DaoManager(script("11"), []);
    const lock = script("22");
    const [firstWithdrawal, secondWithdrawal] = withdrawalCells(
      manager,
      lock,
      "55",
      "66",
    );
    let requestedPageSize = 0;
    const testClient = new StubClient({
      async *findCells(
        _query,
        _order,
        pageSize = 10,
      ): ReturnType<ccc.Client["findCells"]> {
        requestedPageSize = pageSize;
        await Promise.resolve();
        yield firstWithdrawal;
        yield secondWithdrawal;
      },
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        await Promise.resolve();
        return headerLike(1n);
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return transactionWithHeader(headerLike(2n));
      },
    });

    const withdrawals = await collect(
      manager.findWithdrawalRequests(testClient, [lock], {
        tip: headerLike(3n),
        pageSize: 1,
      }),
    );

    expect(requestedPageSize).toBe(1);
    expect(withdrawals.map((withdrawal) => withdrawal.cell.outPoint.txHash)).toEqual([
      firstWithdrawal.outPoint.txHash,
      secondWithdrawal.outPoint.txHash,
    ]);
  });
});

describe(`${FIND_WITHDRAWAL_REQUESTS_SUITE} on-chain scanning`, () => {
  it("uses default tip and on-chain scans when requested", async () => {
    const manager = new DaoManager(script("11"), []);
    const lock = script("22");
    const [withdrawal] = withdrawalCells(manager, lock, "55", "66");
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
        yield withdrawal;
      },
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        await Promise.resolve();
        return headerLike(1n);
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return transactionWithHeader(headerLike(2n));
      },
    });

    const withdrawals = await collect(
      manager.findWithdrawalRequests(testClient, [lock], { onChain: true }),
    );

    expect(tipReads).toBe(1);
    expect(onChainPageSize).toBeGreaterThan(1);
    expect(withdrawals).toHaveLength(1);
  });
});

describe(`${FIND_WITHDRAWAL_REQUESTS_SUITE} concurrent decoding`, () => {
  it("decodes withdrawals concurrently and yields scan order", async () => {
    const manager = new DaoManager(script("11"), []);
    const lock = script("22");
    const [firstWithdrawal, secondWithdrawal] = withdrawalCells(
      manager,
      lock,
      "55",
      "66",
    );
    const requests: ccc.Hex[] = [];
    const { promise: firstFetch, resolve: resolveFirst } =
      Promise.withResolvers<TransactionWithHeader>();
    const { promise: secondFetch, resolve: resolveSecond } =
      Promise.withResolvers<TransactionWithHeader>();
    const testClient = new StubClient({
      async *findCells(): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        yield firstWithdrawal;
        yield secondWithdrawal;
      },
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        await Promise.resolve();
        return headerLike(1n);
      },
      getTransactionWithHeader: async (
        txHash,
      ): ReturnType<ccc.Client["getTransactionWithHeader"]> => {
        const hash = ccc.hexFrom(txHash);
        requests.push(hash);
        return hash === firstWithdrawal.outPoint.txHash ? firstFetch : secondFetch;
      },
    });

    const withdrawalsPromise = collect(
      manager.findWithdrawalRequests(testClient, [lock], { tip: headerLike(3n) }),
    );

    await vi.waitFor(() => {
      expect(requests).toEqual([
        firstWithdrawal.outPoint.txHash,
        secondWithdrawal.outPoint.txHash,
      ]);
    });
    resolveSecond(transactionWithHeader(headerLike(2n)));
    await Promise.resolve();
    resolveFirst(transactionWithHeader(headerLike(2n)));

    const withdrawals = await withdrawalsPromise;

    expect(withdrawals.map((withdrawal) => withdrawal.cell.outPoint.txHash)).toEqual([
      firstWithdrawal.outPoint.txHash,
      secondWithdrawal.outPoint.txHash,
    ]);
  });
});

describe(`${FIND_WITHDRAWAL_REQUESTS_SUITE} single-lock cache reuse`, () => {
  it("deduplicates withdrawal transaction and deposit header requests during a scan", async () => {
    const manager = new DaoManager(script("11"), []);
    const lock = script("22");
    const txHash = byte32FromByte("55");
    const firstWithdrawal = withdrawalCell(manager, lock, txHash, 0n);
    const secondWithdrawal = withdrawalCell(manager, lock, txHash, 1n);
    let headerCalls = 0;
    let transactionCalls = 0;
    const testClient = new StubClient({
      async *findCells(): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        yield firstWithdrawal;
        yield secondWithdrawal;
      },
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        headerCalls += 1;
        await Promise.resolve();
        return headerLike(1n);
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        transactionCalls += 1;
        await Promise.resolve();
        return transactionWithHeader(headerLike(2n));
      },
    });

    const withdrawals = await collect(
      manager.findWithdrawalRequests(testClient, [lock], { tip: headerLike(3n) }),
    );

    expect(headerCalls).toBe(1);
    expect(transactionCalls).toBe(1);
    expect(withdrawals).toHaveLength(2);
  });
});

describe(`${FIND_WITHDRAWAL_REQUESTS_SUITE} multi-lock cache reuse`, () => {
  it("reuses withdrawal transaction and deposit header requests across lock scans", async () => {
    const manager = new DaoManager(script("11"), []);
    const firstLock = script("22");
    const secondLock = script("33");
    const txHash = byte32FromByte("55");
    const firstWithdrawal = withdrawalCell(manager, firstLock, txHash, 0n);
    const secondWithdrawal = withdrawalCell(manager, secondLock, txHash, 1n);
    let headerCalls = 0;
    let transactionCalls = 0;
    const testClient = new StubClient({
      async *findCells(query): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        yield ccc.Script.from(query.script).eq(firstLock)
          ? firstWithdrawal
          : secondWithdrawal;
      },
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        headerCalls += 1;
        await Promise.resolve();
        return headerLike(1n);
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        transactionCalls += 1;
        await Promise.resolve();
        return transactionWithHeader(headerLike(2n));
      },
    });

    const withdrawals = await collect(
      manager.findWithdrawalRequests(testClient, [firstLock, secondLock], {
        tip: headerLike(3n),
      }),
    );

    expect(headerCalls).toBe(1);
    expect(transactionCalls).toBe(1);
    expect(withdrawals.map((withdrawal) => withdrawal.cell.outPoint.index)).toEqual([
      0n,
      1n,
    ]);
  });
});

function withdrawalCells(
  manager: DaoManager,
  lock: ccc.Script,
  firstByte: string,
  secondByte: string,
): [ccc.Cell, ccc.Cell] {
  return [
    withdrawalCell(manager, lock, byte32FromByte(firstByte), 0n),
    withdrawalCell(manager, lock, byte32FromByte(secondByte), 0n),
  ];
}

function withdrawalCell(
  manager: DaoManager,
  lock: ccc.Script,
  txHash: ccc.Hex,
  index: bigint,
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash, index },
    cellOutput: { capacity: ccc.fixedPointFrom(100082), lock, type: manager.script },
    outputData: ccc.mol.Uint64LE.encode(1n),
  });
}
