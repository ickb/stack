import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { DaoManager } from "./dao.js";

function hash(byte: string): `0x${string}` {
  return `0x${byte.repeat(32)}`;
}

function script(byte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: hash(byte),
    hashType: "type",
    args: "0x",
  });
}

function headerLike(epoch: [bigint, bigint, bigint], number: bigint): ccc.ClientBlockHeader {
  return ccc.ClientBlockHeader.from({
    compactTarget: 0n,
    dao: {
      c: 0n,
      ar: 1000n,
      s: 0n,
      u: 0n,
    },
    epoch,
    extraHash: hash("aa"),
    hash: hash("bb"),
    nonce: 0n,
    number,
    parentHash: hash("cc"),
    proposalsHash: hash("dd"),
    timestamp: 0n,
    transactionsRoot: hash("ee"),
    version: 0n,
  });
}

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
  return {
    getTransactionWithHeader: () => Promise.resolve({ header: depositHeader }),
  } as unknown as ccc.Client;
}

describe("daoCellFrom deposit readiness boundaries", () => {
  it("keeps deposits at the exact min boundary pending until the next tip", async () => {
    const lock = script("22");
    const dao = script("33");
    const manager = new DaoManager(dao, []);
    const depositHeader = headerLike([1n, 0n, 1n], 1n);
    const tip = headerLike([180n, 23n, 24n], 2n);

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
    expect(daoCell.maturity.eq(ccc.calcDaoClaimEpoch(depositHeader, tip).add([180n, 0n, 1n]))).toBe(true);
  });

  it("keeps deposits at the exact max boundary out of the ready window", async () => {
    const lock = script("22");
    const dao = script("33");
    const manager = new DaoManager(dao, []);
    const depositHeader = headerLike([1n, 0n, 1n], 1n);
    const tip = headerLike([163n, 0n, 1n], 2n);

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
