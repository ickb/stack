import { ccc } from "@ckb-ccc/core";
import { StubClient, type StubCell } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { SignerCombined } from "../../src/utils/signer.ts";
import { hash } from "../transaction/base/support/sdk_core_support.ts";

const FIRST_KEY = `0x${"11".repeat(32)}`;
const SECOND_KEY = `0x${"22".repeat(32)}`;
// No anyone-can-pay cells: each key's address list is its secp256k1 lock alone.
const client = new StubClient({ cells: (): readonly StubCell[] => [] });
const first = new ccc.SignerCkbPrivateKey(client, FIRST_KEY);
const second = new ccc.SignerCkbPrivateKey(client, SECOND_KEY);
const signer = new SignerCombined([first, second]);

/** A transaction spending one 100 CKB cell under each lock, in this order. */
function spending(locks: ccc.Script[]): ccc.Transaction {
  const tx = ccc.Transaction.default();
  for (const [index, lock] of locks.entries()) {
    tx.addInput(
      ccc.Cell.from({
        outPoint: { txHash: hash(`7${String(index)}`), index: 0n },
        cellOutput: { capacity: ccc.fixedPointFrom(100), lock },
        outputData: "0x",
      }),
    );
  }
  return tx;
}

describe("SignerCombined", () => {
  it("lists every signer's addresses, the primary's first and recommended", async () => {
    const { script: primary } = await signer.getRecommendedAddressObj();
    const { script: other } = await second.getRecommendedAddressObj();

    expect((await signer.getAddressObjs()).map(({ script }) => script)).toEqual([
      primary,
      other,
    ]);
    expect(primary.eq(other)).toBe(false);
  });

  it("prepares and signs every signer's lock group, in any input order", async () => {
    const { script: primary } = await signer.getRecommendedAddressObj();
    const { script: other } = await second.getRecommendedAddressObj();
    const prepared = await signer.prepareTransaction(spending([other, primary]));
    const signed = await signer.signOnlyTransaction(prepared.clone());

    // The placeholders sized every witness before any signature.
    expect(signed.toBytes()).toHaveLength(prepared.toBytes().length);
    for (const [lock, publicKey] of [
      [other, second.publicKey],
      [primary, first.publicKey],
    ] as const) {
      // Each message is taken before any signature: a key signing its own group leaves
      // every other group's message unchanged.
      const info = await prepared.getSignHashInfo(lock, client);
      const signature =
        info === undefined ? undefined : signed.getWitnessArgs(info.position)?.lock;
      if (info === undefined || signature === undefined) {
        throw new Error("Expected a signed group");
      }
      expect(ccc.verifyMessageSecp256k1(info.message, signature, publicKey)).toBe(true);
    }
  });

  it("signs exactly as CCC's key signer when it combines only that one", async () => {
    const { script: primary } = await first.getRecommendedAddressObj();

    const own = await new SignerCombined([first]).signTransaction(spending([primary]));

    expect(own.toBytes()).toEqual(
      (await first.signTransaction(spending([primary]))).toBytes(),
    );
  });

  it("signs messages as the primary", async () => {
    const signature = await signer.signMessage("message");

    expect(signature).toEqual(await first.signMessage("message"));
    await expect(signer.verifyMessage("message", signature)).resolves.toBe(true);
  });

  it("connects every signer and is connected only while each is", async () => {
    const events: string[] = [];
    // A wallet-like signer: disconnected until asked, and replaceable.
    class Wallet extends ccc.SignerCkbPrivateKey {
      #connected = false;
      public override async connect(): Promise<void> {
        await Promise.resolve();
        this.#connected = true;
      }
      public override async disconnect(): Promise<void> {
        await Promise.resolve();
        this.#connected = false;
      }
      public override async isConnected(): Promise<boolean> {
        await Promise.resolve();
        return this.#connected;
      }
      public override onReplaced(listener: () => void): () => void {
        events.push("registered");
        listener();
        return () => {
          events.push("unregistered");
        };
      }
    }
    const combined = new SignerCombined([first, new Wallet(client, SECOND_KEY)]);

    await expect(combined.isConnected()).resolves.toBe(false);
    await combined.connect();
    await expect(combined.isConnected()).resolves.toBe(true);
    await combined.disconnect();
    await expect(combined.isConnected()).resolves.toBe(false);
    combined.onReplaced(() => {
      events.push("replaced");
    })();
    expect(events).toEqual(["registered", "replaced", "unregistered"]);
    expect(combined.type).toBe(first.type);
    await expect(combined.getInternalAddress()).resolves.toBe(
      await first.getInternalAddress(),
    );
  });

  it("refuses an empty list or signers on different clients", () => {
    const elsewhere = new ccc.SignerCkbPrivateKey(
      new StubClient({ cells: (): readonly StubCell[] => [] }),
      SECOND_KEY,
    );

    expect(() => new SignerCombined([])).toThrow("need a primary");
    expect(() => new SignerCombined([first, elsewhere])).toThrow("share one client");
  });
});
