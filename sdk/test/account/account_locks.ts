import { ccc } from "@ckb-ccc/core";
import { script, StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { signerAccountLocks } from "../../src/utils/signer.ts";

class AddressStubSigner extends ccc.SignerCkbPrivateKey {
  private readonly recommended: ccc.Address;
  private readonly addresses: ccc.Address[];

  constructor(recommended: ccc.Address, addresses: ccc.Address[]) {
    super(new StubClient(), `0x${"11".repeat(32)}`);
    this.recommended = recommended;
    this.addresses = addresses;
  }

  public override async getRecommendedAddressObj(): Promise<ccc.Address> {
    await Promise.resolve();
    return this.recommended;
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
    const signer = new AddressStubSigner(new ccc.Address(primaryLock, "ckt"), [
      new ccc.Address(otherLock, "ckt"),
      new ccc.Address(primaryLockCopy, "ckt"),
    ]);

    await expect(signerAccountLocks(signer)).resolves.toEqual([primaryLock, otherLock]);
  });
});
