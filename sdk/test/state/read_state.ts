import { ccc } from "@ckb-ccc/core";
import type { cccA } from "@ckb-ccc/core/advanced";
import { script, type StubCell } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { WALLET_LOCK_UP } from "../../src/dao.ts";
import { readState } from "../../src/state.ts";
import { signerAccountLocks } from "../../src/utils/signer.ts";
import { hash, headerLike } from "../transaction/base/support/sdk_core_support.ts";
import { anchoredAt, FeeRateStubClient } from "./l1_account/support/sdk_l1_support.ts";

/** A signer whose addresses the test sets, over the client it is given. */
class AddressStubSigner extends ccc.SignerCkbPrivateKey {
  public addresses: ccc.Address[];
  private readonly recommended: ccc.Address;

  constructor(client: ccc.Client, recommended: ccc.Script, others: ccc.Script[]) {
    super(client, `0x${"11".repeat(32)}`);
    this.recommended = new ccc.Address(recommended, "ckt");
    this.addresses = others.map((lock) => new ccc.Address(lock, "ckt"));
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

describe("readState", () => {
  it("scans every lock of the signer's addresses, asked again on each read", async () => {
    const recommended = script("11");
    const second = script("22");
    const added = script("33");
    const cells = new Map(
      [recommended, second, added].map((lock, index) => [
        lock.hash(),
        ccc.Cell.from({
          outPoint: { txHash: hash(String(81 + index)), index: 0n },
          cellOutput: { capacity: ccc.fixedPointFrom(100), lock },
          outputData: "0x",
        }),
      ]),
    );
    const client = new FeeRateStubClient({
      ...anchoredAt(headerLike(1n, { timestamp: BigInt(Date.now()) })),
      cells: ({ script: key }: cccA.JsonRpcIndexerSearchKey): readonly StubCell[] => {
        const found = cells.get(
          ccc.Script.from({
            codeHash: key.code_hash,
            hashType: key.hash_type,
            args: key.args,
          }).hash(),
        );
        return found === undefined ? [] : [found];
      },
    });
    const signer = new AddressStubSigner(client, recommended, [second]);

    const state = await readState(signer);

    expect(state.cells.map(({ cellOutput }) => cellOutput.lock)).toEqual([
      recommended,
      second,
    ]);
    // Every output a conversion creates goes to the recommended lock, under wallet timing.
    expect(state.changeLock).toEqual(recommended);
    expect(state.lockUp).toBe(WALLET_LOCK_UP);
    expect(state.ckbNative).toBe(ccc.fixedPointFrom(200));

    signer.addresses.push(new ccc.Address(added, "ckt"));
    const next = await readState(signer);

    expect(next.cells.map(({ cellOutput }) => cellOutput.lock)).toEqual([
      recommended,
      second,
      added,
    ]);
  });
});

describe("signerAccountLocks", () => {
  it("keeps the recommended lock first and deduplicates account locks", async () => {
    const primaryLock = script("11");
    const otherLock = script("22");
    const signer = new AddressStubSigner(new FeeRateStubClient(), primaryLock, [
      otherLock,
      ccc.Script.from(primaryLock),
    ]);

    await expect(signerAccountLocks(signer)).resolves.toEqual([primaryLock, otherLock]);
  });
});
