import { ccc } from "@ckb-ccc/core";

/** CKB signer test double whose address set is fixed at construction. */
export class FakeCkbSigner extends ccc.Signer {
  private readonly locks: ccc.Script[];

  constructor(client: ccc.Client, locks: ccc.Script[]) {
    super(client);
    this.locks = locks;
  }

  public override get type(): ccc.SignerType {
    return ccc.SignerType.CKB;
  }

  public override get signType(): ccc.SignerSignType {
    return ccc.SignerSignType.CkbSecp256k1;
  }

  public override async connect(): Promise<void> {
    await Promise.resolve();
  }

  public override async isConnected(): Promise<boolean> {
    await Promise.resolve();
    return true;
  }

  public override async getInternalAddress(): Promise<string> {
    await Promise.resolve();
    return "ckt1test";
  }

  public override async getAddressObjs(): Promise<ccc.Address[]> {
    await Promise.resolve();
    return this.locks.map((lock) => new ccc.Address(lock, "ckt"));
  }
}
