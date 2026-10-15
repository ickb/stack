import { ccc } from "@ckb-ccc/core";
import { script, StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { signerAccountLocks } from "../../src/send/sign_and_send_transaction.ts";

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
});
