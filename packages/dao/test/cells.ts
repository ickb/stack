import { ccc } from "@ckb-ccc/core";
import {
  byte32FromByte,
  script,
  StubClient,
  headerLike as testHeaderLike,
} from "@ickb/testkit";
import { expect, it, vi } from "vitest";
import { DaoManager } from "../src/dao.ts";

const DAO_CELL_WITHDRAWAL_READINESS_SUITE = "daoCellFrom withdrawal readiness";
const FULL_WORKSPACE_TIMEOUT_MS = 20_000;

function headerLike(
  epoch: [bigint, bigint, bigint],
  number: bigint,
  timestamp = 0n,
): ccc.ClientBlockHeader {
  return testHeaderLike({
    epoch,
    number,
    timestamp,
  });
}

function withdrawalCell(): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("11"), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: script("22"),
      type: script("33"),
    },
    outputData: ccc.mol.Uint64LE.encode(1n),
  });
}

function clientFor(
  depositHeader: ccc.ClientBlockHeader,
  withdrawHeader: ccc.ClientBlockHeader,
): ccc.Client {
  return new StubClient({
    getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
      await Promise.resolve();
      return depositHeader;
    },
    getTransactionWithHeader: async (): ReturnType<
      ccc.Client["getTransactionWithHeader"]
    > => {
      await Promise.resolve();
      return {
        transaction: ccc.ClientTransactionResponse.from({
          transaction: ccc.Transaction.default(),
          status: "committed",
        }),
        header: withdrawHeader,
      };
    },
  });
}

it(`${DAO_CELL_WITHDRAWAL_READINESS_SUITE} marks withdrawal requests ready once the claim epoch is reached`, async () => {
  const manager = new DaoManager(script("33"), []);
  const depositHeader = ccc.ClientBlockHeader.from(headerLike([1n, 0n, 1n], 1n));
  const withdrawHeader = ccc.ClientBlockHeader.from(headerLike([180n, 0n, 1n], 2n));
  const tip = ccc.ClientBlockHeader.from(headerLike([181n, 0n, 1n], 3n));
  const claimEpoch = ccc.calcDaoClaimEpoch(depositHeader, withdrawHeader);

  const daoCell = await manager.withdrawalRequestCellFrom(
    withdrawalCell(),
    clientFor(depositHeader, withdrawHeader),
    { tip },
  );

  expect(daoCell.maturity.eq(claimEpoch)).toBe(true);
  expect(daoCell.isReady).toBe(true);
});

it(`${DAO_CELL_WITHDRAWAL_READINESS_SUITE} keeps withdrawal requests pending before the claim epoch`, async () => {
  const manager = new DaoManager(script("33"), []);
  const depositHeader = ccc.ClientBlockHeader.from(headerLike([1n, 0n, 1n], 1n));
  const withdrawHeader = ccc.ClientBlockHeader.from(headerLike([180n, 0n, 1n], 2n));
  const tip = ccc.ClientBlockHeader.from(headerLike([179n, 0n, 1n], 3n));

  const daoCell = await manager.withdrawalRequestCellFrom(
    withdrawalCell(),
    clientFor(depositHeader, withdrawHeader),
    { tip },
  );

  expect(daoCell.isReady).toBe(false);
});

it(`${DAO_CELL_WITHDRAWAL_READINESS_SUITE} rejects invalid withdrawal payloads`, async () => {
  const manager = new DaoManager(script("33"), []);
  const cell = withdrawalCell();
  cell.outputData = "0x12";

  await expect(
    manager.withdrawalRequestCellFrom(cell, new StubClient(), {
      tip: ccc.ClientBlockHeader.from(headerLike([181n, 0n, 1n], 3n)),
    }),
  ).rejects.toThrow("Invalid DAO withdrawal request payload");
});

it(`${DAO_CELL_WITHDRAWAL_READINESS_SUITE} fetches withdrawal deposit and request headers concurrently`, async () => {
  const manager = new DaoManager(script("33"), []);
  const depositHeader = ccc.ClientBlockHeader.from(headerLike([1n, 0n, 1n], 1n));
  const withdrawHeader = ccc.ClientBlockHeader.from(headerLike([180n, 0n, 1n], 2n));
  const tip = ccc.ClientBlockHeader.from(headerLike([181n, 0n, 1n], 3n));
  const calls: string[] = [];
  const { promise: depositFetch, resolve: resolveDeposit } = Promise.withResolvers<
    ccc.ClientBlockHeader | undefined
  >();
  const { promise: withdrawFetch, resolve: resolveWithdraw } =
    Promise.withResolvers<Awaited<ReturnType<ccc.Client["getTransactionWithHeader"]>>>();
  const client = new StubClient({
    getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
      calls.push("deposit");
      return depositFetch;
    },
    getTransactionWithHeader: async (): ReturnType<
      ccc.Client["getTransactionWithHeader"]
    > => {
      calls.push("withdraw");
      return withdrawFetch;
    },
  });

  const daoCellPromise = manager.withdrawalRequestCellFrom(withdrawalCell(), client, {
    tip,
  });

  await vi.waitFor(() => {
    expect(calls).toEqual(["deposit", "withdraw"]);
  });
  resolveWithdraw({
    transaction: ccc.ClientTransactionResponse.from({
      transaction: ccc.Transaction.default(),
      status: "committed",
    }),
    header: withdrawHeader,
  });
  await Promise.resolve();
  resolveDeposit(depositHeader);

  const daoCell = await daoCellPromise;

  expect(daoCell.headers[0].header.number).toBe(depositHeader.number);
  expect(daoCell.headers[1].header.number).toBe(withdrawHeader.number);
});

it(
  `${DAO_CELL_WITHDRAWAL_READINESS_SUITE} rejects cells when required headers are unavailable`,
  async () => {
    const manager = new DaoManager(script("33"), []);
    const deposit = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("22"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: script("22"),
        type: manager.script,
      },
      outputData: DaoManager.depositData(),
    });
    const missingTransactionClient = new StubClient({
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return undefined;
      },
    });
    const missingDepositHeaderClient = new StubClient({
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        await Promise.resolve();
        return undefined;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return {
          transaction: ccc.ClientTransactionResponse.from({
            transaction: ccc.Transaction.default(),
            status: "committed",
          }),
          header: ccc.ClientBlockHeader.from(headerLike([180n, 0n, 1n], 2n)),
        };
      },
    });
    const missingDepositHeaderCell = withdrawalCell();
    const missingRequestHeaderCell = withdrawalCell();

    await expect(
      manager.depositCellFrom(deposit, missingTransactionClient, {
        tip: ccc.ClientBlockHeader.from(headerLike([1n, 0n, 1n], 1n)),
      }),
    ).rejects.toThrow(
      `Header not found for txHash ${deposit.outPoint.txHash} at ${deposit.outPoint.toHex()}`,
    );
    await expect(
      manager.withdrawalRequestCellFrom(
        missingDepositHeaderCell,
        missingDepositHeaderClient,
        {
          tip: ccc.ClientBlockHeader.from(headerLike([181n, 0n, 1n], 3n)),
        },
      ),
    ).rejects.toThrow(
      `Header not found for block number 1 at ${missingDepositHeaderCell.outPoint.toHex()}`,
    );
    await expect(
      manager.withdrawalRequestCellFrom(
        missingRequestHeaderCell,
        missingTransactionClient,
        {
          tip: ccc.ClientBlockHeader.from(headerLike([181n, 0n, 1n], 3n)),
        },
      ),
    ).rejects.toThrow(
      `Header not found for txHash ${missingRequestHeaderCell.outPoint.txHash} at ${missingRequestHeaderCell.outPoint.toHex()}`,
    );
  },
  FULL_WORKSPACE_TIMEOUT_MS,
);

it(`${DAO_CELL_WITHDRAWAL_READINESS_SUITE} preserves cell context when header reads fail`, async () => {
  const manager = new DaoManager(script("33"), []);
  const depositTransactionError = new Error("transaction rpc failed");
  const depositHeaderError = new Error("header rpc failed");
  const withdrawalTransactionError = new Error("transaction rpc failed");
  const deposit = ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("22"), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: script("22"),
      type: manager.script,
    },
    outputData: DaoManager.depositData(),
  });
  const withdrawal = withdrawalCell();
  const failedTransactionClient = new StubClient({
    getTransactionWithHeader: async (): ReturnType<
      ccc.Client["getTransactionWithHeader"]
    > => {
      await Promise.resolve();
      throw depositTransactionError;
    },
  });
  const failedDepositHeaderClient = new StubClient({
    getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
      await Promise.resolve();
      throw depositHeaderError;
    },
    getTransactionWithHeader: async (): ReturnType<
      ccc.Client["getTransactionWithHeader"]
    > => {
      await Promise.resolve();
      return {
        transaction: ccc.ClientTransactionResponse.from({
          transaction: ccc.Transaction.default(),
          status: "committed",
        }),
        header: ccc.ClientBlockHeader.from(headerLike([180n, 0n, 1n], 2n)),
      };
    },
  });
  const failedWithdrawalTransactionClient = new StubClient({
    getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
      await Promise.resolve();
      return ccc.ClientBlockHeader.from(headerLike([1n, 0n, 1n], 1n));
    },
    getTransactionWithHeader: async (): ReturnType<
      ccc.Client["getTransactionWithHeader"]
    > => {
      await Promise.resolve();
      throw withdrawalTransactionError;
    },
  });

  await expect(
    manager.depositCellFrom(deposit, failedTransactionClient, {
      tip: ccc.ClientBlockHeader.from(headerLike([1n, 0n, 1n], 1n)),
    }),
  ).rejects.toMatchObject({
    message: `Failed to load transaction header for txHash ${deposit.outPoint.txHash} at ${deposit.outPoint.toHex()}`,
    cause: depositTransactionError,
  });
  await expect(
    manager.withdrawalRequestCellFrom(withdrawal, failedDepositHeaderClient, {
      tip: ccc.ClientBlockHeader.from(headerLike([181n, 0n, 1n], 3n)),
    }),
  ).rejects.toMatchObject({
    message: `Failed to load header for block number 1 at ${withdrawal.outPoint.toHex()}`,
    cause: depositHeaderError,
  });
  await expect(
    manager.withdrawalRequestCellFrom(withdrawal, failedWithdrawalTransactionClient, {
      tip: ccc.ClientBlockHeader.from(headerLike([181n, 0n, 1n], 3n)),
    }),
  ).rejects.toMatchObject({
    message: `Failed to load transaction header for txHash ${withdrawal.outPoint.txHash} at ${withdrawal.outPoint.toHex()}`,
    cause: withdrawalTransactionError,
  });
});
