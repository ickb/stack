import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { daoCellFrom } from "./cells.js";

function byte32FromByte(hexByte: string): `0x${string}` {
  if (!/^[0-9a-f]{2}$/iu.test(hexByte)) {
    throw new Error("Expected exactly one byte as two hex chars");
  }
  return `0x${hexByte.repeat(32)}`;
}

function script(codeHashByte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(codeHashByte),
    hashType: "type",
    args: "0x",
  });
}

function headerLike(
  epoch: [bigint, bigint, bigint],
  number: bigint,
  timestamp = 0n,
): {
  compactTarget: bigint;
  dao: {
    c: bigint;
    ar: bigint;
    s: bigint;
    u: bigint;
  };
  epoch: [bigint, bigint, bigint];
  extraHash: `0x${string}`;
  hash: `0x${string}`;
  nonce: bigint;
  number: bigint;
  parentHash: `0x${string}`;
  proposalsHash: `0x${string}`;
  timestamp: bigint;
  transactionsRoot: `0x${string}`;
  version: bigint;
} {
  return {
    compactTarget: 0n,
    dao: {
      c: 0n,
      ar: 1000n,
      s: 0n,
      u: 0n,
    },
    epoch,
    extraHash: byte32FromByte("aa"),
    hash: byte32FromByte("bb"),
    nonce: 0n,
    number,
    parentHash: byte32FromByte("cc"),
    proposalsHash: byte32FromByte("dd"),
    timestamp,
    transactionsRoot: byte32FromByte("ee"),
    version: 0n,
  };
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
    const depositHeader = ccc.ClientBlockHeader.from(headerLike([1n, 0n, 1n], 1n));
    const withdrawHeader = ccc.ClientBlockHeader.from(headerLike([180n, 0n, 1n], 2n));
    const tip = ccc.ClientBlockHeader.from(headerLike([181n, 0n, 1n], 3n));
    const claimEpoch = ccc.calcDaoClaimEpoch(depositHeader, withdrawHeader);

    const daoCell = await daoCellFrom({
      cell: withdrawalCell(),
      isDeposit: false,
      client: clientFor(depositHeader, withdrawHeader),
      tip,
    });

    expect(daoCell.maturity.eq(claimEpoch)).toBe(true);
    expect(daoCell.isReady).toBe(true);
  });

  it("keeps withdrawal requests pending before the claim epoch", async () => {
    const depositHeader = ccc.ClientBlockHeader.from(headerLike([1n, 0n, 1n], 1n));
    const withdrawHeader = ccc.ClientBlockHeader.from(headerLike([180n, 0n, 1n], 2n));
    const tip = ccc.ClientBlockHeader.from(headerLike([179n, 0n, 1n], 3n));

    const daoCell = await daoCellFrom({
      cell: withdrawalCell(),
      isDeposit: false,
      client: clientFor(depositHeader, withdrawHeader),
      tip,
    });

    expect(daoCell.isReady).toBe(false);
  });
});
