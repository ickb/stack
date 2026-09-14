import { ccc } from "@ckb-ccc/core";
import { offlineTestnetClient, script as typeScript } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../src/constants.ts";
import { IckbSdk } from "../src/sdk.ts";

function script(byte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: typeScript(byte).codeHash,
    hashType: "data1",
    args: "0x",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getConfig", () => {
  it("rejects removed custom deployment configs at runtime", () => {
    const unsupportedNetwork = {};
    // @ts-expect-error Runtime rejection protects untyped JavaScript consumers.
    expect(() => getConfig(unsupportedNetwork)).toThrow("unsupported iCKB network");
  });

  it("builds the SDK from one coherent config object", async () => {
    const config = getConfig("testnet");
    const { dao, ickbUdt, logic, order, ownedOwner } = config.managers;
    const sdk = IckbSdk.fromChain("testnet");
    const tx = ccc.Transaction.default();
    const client = offlineTestnetClient();
    const signer = new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockResolvedValue([0, false]);

    expect(sdk).toBeInstanceOf(IckbSdk);
    expect(logic.daoManager).toBe(dao);
    expect(ownedOwner.daoManager).toBe(dao);
    expect(order.udtScript.eq(ickbUdt.script)).toBe(true);
    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate: 1n,
      cells: [],
    });

    expect(completed).not.toBe(tx);
    expect(completed.cellDeps).toHaveLength(2);
    expect(tx.cellDeps).toEqual([]);
  });
});

describe("getConfig defaults", () => {
  it("resolves mainnet defaults and appends custom bot locks", () => {
    const customBot = script("aa");
    const config = getConfig("mainnet", [customBot]);
    const { dao, ickbUdt, logic, order, ownedOwner } = config.managers;
    const customBots = config.bots.filter((bot) => bot.eq(customBot));
    const logicScript =
      "0x350000001000000030000000310000002a8100ab5990fa055ab1b50891702e1e895c7bd1df6322cd725c1a6115873bd30200000000";
    const udtScript =
      "0x5900000010000000300000003100000050bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b950224000000b73b6ab39d79390c6de90a09c96b290c331baf1798ed6f97aed02590929734e800000080";
    const depGroup =
      "0x621a6f38de3b9f453016780edac3b26bfcbfa3e2ecb47c2da275471a5d3ed1650000000001";

    expect(logic.script.toHex()).toBe(logicScript);
    expect(ickbUdt.logicScript.toHex()).toBe(logicScript);
    expect(ownedOwner.script.toHex()).toBe(
      "0x35000000100000003000000031000000acc79e07d107831feef4c70c9e683dac5644d5993b9cb106dca6e74baa381bd00200000000",
    );
    expect(order.script.toHex()).toBe(
      "0x3500000010000000300000003100000049dfb6afee5cc8ac4225aeea8cb8928b150caf3cd92fea33750683c74b13254a0200000000",
    );
    expect(ickbUdt.script.toHex()).toBe(udtScript);
    expect(order.udtScript.toHex()).toBe(udtScript);
    expect(ickbUdt.udtCode.toHex()).toBe(
      "0xc07844ce21b38e4b071dd0e1ee3b0e27afd8d7532491327f39b786343f558ab700000000",
    );
    expect(ickbUdt.logicCode.toHex()).toBe(
      "0xd7309191381f5a8a2904b8a79958a9be2752dbba6871fa193dab6aeb29dc8f4400000000",
    );
    for (const manager of [dao, logic, ownedOwner, order]) {
      expect(manager.cellDeps.map((cellDep) => cellDep.toHex())).toEqual([depGroup]);
    }
    expect(customBots).toHaveLength(1);
    expect(config.bots).toHaveLength(2);
  });
});
