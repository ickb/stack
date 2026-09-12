import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, capacityCell, script, StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import {
  accountPlainCkbBalance,
  signerAccountLocks,
} from "../../src/conversion/account_locks.ts";

class AddressStubSigner extends ccc.SignerCkbPrivateKey {
  private readonly addresses: ccc.Address[];

  constructor(addresses: ccc.Address[]) {
    super(new StubClient(), `0x${"11".repeat(32)}`);
    this.addresses = addresses;
  }

  public override async getAddressObjs(): Promise<ccc.Address[]> {
    await Promise.resolve();
    return this.addresses;
  }
}

describe("account locks and balances", () => {
  it("keeps the primary signer lock first and deduplicates account locks", async () => {
    const primaryLock = script("11");
    const primaryLockCopy = ccc.Script.from(primaryLock);
    const otherLock = script("22");
    const signer = new AddressStubSigner([
      new ccc.Address(otherLock, "ckt"),
      new ccc.Address(primaryLockCopy, "ckt"),
    ]);

    await expect(signerAccountLocks(signer, primaryLock)).resolves.toEqual([
      primaryLock,
      otherLock,
    ]);
  });

  it("counts account plain CKB from owned plain capacity cells only", () => {
    const { lock, otherLock, unspent, typed, data } = accountCellFixture();

    expect(
      accountPlainCkbBalance(
        [unspent, typed, data, capacityCell(100n, otherLock, "ee")],
        [lock],
      ),
    ).toBe(ccc.fixedPointFrom(2000));
  });
});

function accountCellFixture(): {
  lock: ccc.Script;
  otherLock: ccc.Script;
  unspent: ccc.Cell;
  typed: ccc.Cell;
  data: ccc.Cell;
} {
  const lock = script("11");
  const otherLock = script("22");
  return {
    lock,
    otherLock,
    unspent: capacityCell(ccc.fixedPointFrom(2000), lock, "bb"),
    typed: ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("cc"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(4000), lock, type: script("33") },
      outputData: "0x",
    }),
    data: ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("dd"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(8000), lock },
      outputData: "0x1234",
    }),
  };
}
