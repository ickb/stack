import { ccc } from "@ckb-ccc/core";
import { unique } from "./utils.ts";

/**
 * Combines a list of signers into one: each prepares and signs its own lock groups, and the
 * first, the primary, speaks for the combination wherever one answer is needed: its
 * recommended address, and with it the change lock, its identity and message signatures, and
 * its signer type.
 *
 * Signing runs every signer in turn, the primary first. That is order-free only while each
 * signer writes nothing but its own groups' witnesses, as CCC's CKB signers do: a sighash
 * covers its group's witnesses and the ones past the inputs. The signers must also own
 * disjoint locks: two signers of one group would each sign it, the second signature over the
 * first, and every send would fail.
 *
 * @remarks Chosen over a subclass of CCC's key signer that holds several keys: the subclass
 * inherits every member but the three it overrides, and only private keys combine. The
 * combinator takes any signer, at the cost of delegating each member.
 */
export class SignerCombined extends ccc.Signer {
  readonly #signers: readonly [ccc.Signer, ...ccc.Signer[]];

  constructor(signers: readonly ccc.Signer[]) {
    // Checked here once, so callers can pass a mapped list, whose type loses non-emptiness.
    const [primary, ...others] = signers;
    if (primary === undefined) {
      throw new Error("Combined signers need a primary");
    }
    // One client, so every address, cell and signature is read on one chain.
    if (others.some((signer) => signer.client !== primary.client)) {
      throw new Error("Combined signers must share one client");
    }
    super(primary.client);
    this.#signers = [primary, ...others];
  }

  get #primary(): ccc.Signer {
    return this.#signers[0];
  }

  public override get type(): ccc.SignerType {
    return this.#primary.type;
  }

  public override get signType(): ccc.SignerSignType {
    return this.#primary.signType;
  }

  // One at a time: a wallet may allow only one connection prompt open.
  public override async connect(): Promise<void> {
    for (const signer of this.#signers) {
      await signer.connect();
    }
  }

  public override async disconnect(): Promise<void> {
    for (const signer of this.#signers) {
      await signer.disconnect();
    }
  }

  /** Connected only while every signer is: any one missing leaves its groups unsigned. */
  public override async isConnected(): Promise<boolean> {
    const connected = await Promise.all(
      this.#signers.map(async (signer) => signer.isConnected()),
    );
    return connected.every(Boolean);
  }

  /** Replacing any signer replaces the combination. */
  public override onReplaced(listener: () => void): () => void {
    const unregister = this.#signers.map((signer) => signer.onReplaced(listener));
    return () => {
      for (const off of unregister) {
        off();
      }
    };
  }

  public override async getInternalAddress(): Promise<string> {
    return this.#primary.getInternalAddress();
  }

  public override async getIdentity(): Promise<string> {
    return this.#primary.getIdentity();
  }

  /** Every signer's addresses, the primary's first, so an account read covers them all. */
  public override async getAddressObjs(): Promise<ccc.Address[]> {
    const addresses = await Promise.all(
      this.#signers.map(async (signer) => signer.getAddressObjs()),
    );
    return addresses.flat();
  }

  public override async getRecommendedAddressObj(
    preference?: unknown,
  ): Promise<ccc.Address> {
    return this.#primary.getRecommendedAddressObj(preference);
  }

  // The inherited signMessage and verifyMessage pair this with the primary's identity.
  public override async signMessageRaw(message: string | ccc.BytesLike): Promise<string> {
    return this.#primary.signMessageRaw(message);
  }

  // Completion calls this before pricing the fee, so every group's witness is paid for.
  public override async prepareTransaction(
    txLike: ccc.TransactionLike,
  ): Promise<ccc.Transaction> {
    let tx = ccc.Transaction.from(txLike);
    for (const signer of this.#signers) {
      tx = await signer.prepareTransaction(tx);
    }
    return tx;
  }

  public override async signOnlyTransaction(
    txLike: ccc.TransactionLike,
  ): Promise<ccc.Transaction> {
    let tx = ccc.Transaction.from(txLike);
    for (const signer of this.#signers) {
      tx = await signer.signOnlyTransaction(tx);
    }
    return tx;
  }
}

/**
 * Returns the signer's recommended lock first, then every other lock of its addresses,
 * deduplicated by script hash.
 */
export async function signerAccountLocks(signer: ccc.Signer): Promise<ccc.Script[]> {
  const [recommended, addresses] = await Promise.all([
    signer.getRecommendedAddressObj(),
    signer.getAddressObjs(),
  ]);
  return [...unique([recommended.script, ...addresses.map(({ script }) => script)])];
}
