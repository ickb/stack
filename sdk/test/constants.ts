import { ccc } from "@ckb-ccc/core";
import { genesisHeader, headerLike, StubClient } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeTransaction } from "../src/complete.ts";
import {
  CHAINS,
  DAO,
  ICKB_LOGIC,
  ICKB_UDT,
  ORDER,
  OWNED_OWNER,
} from "../src/constants.ts";
import { mustComplete } from "./conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import {
  headerLike as hashedHeader,
  system,
} from "./transaction/base/support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Completes an empty transaction for a signer whose client serves `genesis` as header 0. */
async function completeOn(
  genesis: ccc.ClientBlockHeader | undefined,
): Promise<ccc.Transaction> {
  const client = new StubClient({
    getHeaderByNumber: async (): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      return genesis;
    },
  });
  const signer = new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
  vi.spyOn(ccc.Transaction.prototype, "completeFeeChangeToLock").mockResolvedValue([
    0,
    false,
  ]);
  const { tx } = mustComplete(
    await completeTransaction(ccc.Transaction.default(), {
      signer,
      system: system(),
      receipts: [],
      cells: [],
    }),
  );
  return tx;
}

function depGroup(chain: keyof typeof CHAINS): ccc.CellDep {
  return ccc.CellDep.from({ outPoint: CHAINS[chain].depGroup, depType: "depGroup" });
}

describe("completeTransaction chain", () => {
  it("adds the dep group of the chain whose genesis the signer's client serves", async () => {
    await expect(completeOn(genesisHeader("testnet"))).resolves.toMatchObject({
      cellDeps: [depGroup("testnet")],
    });
    await expect(completeOn(genesisHeader("mainnet"))).resolves.toMatchObject({
      cellDeps: [depGroup("mainnet")],
    });
  });

  it("refuses an unknown, forged, or missing genesis", async () => {
    // A genesis whose hash checks out but names no iCKB deployment, and one that claims
    // testnet's hash over other fields.
    const unknown = hashedHeader(0n);
    const forged = headerLike({ hash: CHAINS.testnet.genesisHash, number: 0n });

    await expect(completeOn(unknown)).rejects.toThrow(new Error("unsupported network"));
    await expect(completeOn(forged)).rejects.toThrow(
      `Header ${CHAINS.testnet.genesisHash} carries the fields of`,
    );
    await expect(completeOn(undefined)).rejects.toThrow("Missing genesis header");
  });
});

describe("fixed scripts", () => {
  it("are the mainnet deployment's, which testnet shares", () => {
    const logicScript =
      "0x350000001000000030000000310000002a8100ab5990fa055ab1b50891702e1e895c7bd1df6322cd725c1a6115873bd30200000000";
    const udtScript =
      "0x5900000010000000300000003100000050bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b950224000000b73b6ab39d79390c6de90a09c96b290c331baf1798ed6f97aed02590929734e800000080";

    expect(ICKB_LOGIC.toHex()).toBe(logicScript);
    expect(OWNED_OWNER.toHex()).toBe(
      "0x35000000100000003000000031000000acc79e07d107831feef4c70c9e683dac5644d5993b9cb106dca6e74baa381bd00200000000",
    );
    expect(ORDER.toHex()).toBe(
      "0x3500000010000000300000003100000049dfb6afee5cc8ac4225aeea8cb8928b150caf3cd92fea33750683c74b13254a0200000000",
    );
    expect(ICKB_UDT.toHex()).toBe(udtScript);
    expect(DAO.codeHash).toBe(
      "0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e",
    );
    expect(depGroup("mainnet").toHex()).toBe(
      "0x621a6f38de3b9f453016780edac3b26bfcbfa3e2ecb47c2da275471a5d3ed1650000000001",
    );
  });

  it("names the genesis hashes of CKB's mainnet and testnet specs", () => {
    expect(CHAINS.mainnet.genesisHash).toBe(genesisHeader("mainnet").hash);
    expect(CHAINS.testnet.genesisHash).toBe(genesisHeader("testnet").hash);
  });
});
