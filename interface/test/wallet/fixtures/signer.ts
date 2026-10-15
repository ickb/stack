import { ccc } from "@ckb-ccc/ccc";
import { StubClient } from "@ickb/testkit";

export class TypeSigner extends ccc.SignerCkbPrivateKey {
  private readonly signerType: ccc.SignerType;

  constructor(signerType: ccc.SignerType) {
    super(new StubClient(), `0x${"11".repeat(32)}`);
    this.signerType = signerType;
  }

  public override get type(): ccc.SignerType {
    return this.signerType;
  }
}
