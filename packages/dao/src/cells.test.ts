import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, headerLike as testHeaderLike, script } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import { DaoManager } from "./dao.js";

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
  return {
    getHeaderByNumber: () => Promise.resolve(depositHeader),
    getTransactionWithHeader: () => Promise.resolve({ header: withdrawHeader }),
  } as unknown as ccc.Client;
}

describe("daoCellFrom withdrawal readiness", () => {
  it("marks withdrawal requests ready once the claim epoch is reached", async () => {
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

  it("keeps withdrawal requests pending before the claim epoch", async () => {
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

  it("fetches withdrawal deposit and request headers concurrently", async () => {
    const manager = new DaoManager(script("33"), []);
    const depositHeader = ccc.ClientBlockHeader.from(headerLike([1n, 0n, 1n], 1n));
    const withdrawHeader = ccc.ClientBlockHeader.from(headerLike([180n, 0n, 1n], 2n));
    const tip = ccc.ClientBlockHeader.from(headerLike([181n, 0n, 1n], 3n));
    const calls: string[] = [];
    let resolveDeposit!: (header: ccc.ClientBlockHeader | undefined) => void;
    let resolveWithdraw!: (res: { header: ccc.ClientBlockHeader } | undefined) => void;
    const depositFetch = new Promise<ccc.ClientBlockHeader | undefined>((resolve) => {
      resolveDeposit = resolve;
    });
    const withdrawFetch = new Promise<{ header: ccc.ClientBlockHeader } | undefined>((resolve) => {
      resolveWithdraw = resolve;
    });
    const client = {
      getHeaderByNumber: async () => {
        calls.push("deposit");
        return depositFetch;
      },
      getTransactionWithHeader: async () => {
        calls.push("withdraw");
        return withdrawFetch;
      },
    } as unknown as ccc.Client;

    const daoCellPromise = manager.withdrawalRequestCellFrom(
      withdrawalCell(),
      client,
      { tip },
    );

    await vi.waitFor(() => {
      expect(calls).toEqual(["deposit", "withdraw"]);
    });
    resolveWithdraw({ header: withdrawHeader });
    await Promise.resolve();
    resolveDeposit(depositHeader);

    const daoCell = await daoCellPromise;

    expect(daoCell.headers[0].header.number).toBe(depositHeader.number);
    expect(daoCell.headers[1].header.number).toBe(withdrawHeader.number);
  });
});
