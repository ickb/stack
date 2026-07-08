import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, headerLike, script, StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { DaoManager } from "../src/dao.ts";

const hash = byte32FromByte;

function depositCell(lock: ccc.Script, dao: ccc.Script): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: hash("11"), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock,
      type: dao,
    },
    outputData: DaoManager.depositData(),
  });
}

function clientFor(depositHeader: ccc.ClientBlockHeader): ccc.Client {
  return new StubClient({
    getTransactionWithHeader: async (): ReturnType<
      ccc.Client["getTransactionWithHeader"]
    > => {
      await Promise.resolve();
      return {
        transaction: ccc.ClientTransactionResponse.from({
          transaction: ccc.Transaction.default(),
          status: "committed",
        }),
        header: depositHeader,
      };
    },
  });
}

describe("daoCellFrom deposit readiness boundaries", () => {
  it("keeps deposits at the exact min boundary pending until the next tip", async () => {
    const lock = script("22");
    const dao = script("33");
    const manager = new DaoManager(dao, []);
    const depositHeader = headerLike({ epoch: [1n, 0n, 1n], number: 1n });
    const tip = headerLike({ epoch: [180n, 23n, 24n], number: 2n });

    const daoCell = await manager.depositCellFrom(
      depositCell(lock, dao),
      clientFor(depositHeader),
      {
        tip,
        minLockUp: ccc.Epoch.from([0n, 1n, 24n]),
        maxLockUp: ccc.Epoch.from([18n, 0n, 1n]),
      },
    );

    expect(daoCell.isReady).toBe(false);
    expect(
      daoCell.maturity.eq(ccc.calcDaoClaimEpoch(depositHeader, tip).add([180n, 0n, 1n])),
    ).toBe(true);
  });

  it("keeps deposits at the exact max boundary out of the ready window", async () => {
    const lock = script("22");
    const dao = script("33");
    const manager = new DaoManager(dao, []);
    const depositHeader = headerLike({ epoch: [1n, 0n, 1n], number: 1n });
    const tip = headerLike({ epoch: [163n, 0n, 1n], number: 2n });

    const daoCell = await manager.depositCellFrom(
      depositCell(lock, dao),
      clientFor(depositHeader),
      {
        tip,
        minLockUp: ccc.Epoch.from([0n, 1n, 24n]),
        maxLockUp: ccc.Epoch.from([18n, 0n, 1n]),
      },
    );

    expect(daoCell.maturity.eq(ccc.calcDaoClaimEpoch(depositHeader, tip))).toBe(true);
    expect(daoCell.isReady).toBe(false);
  });
});
