import { ccc } from "@ckb-ccc/core";
import { outPoint, script as typeScript } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IckbUdt } from "@ickb/core";
import { getConfig } from "./constants.js";
import { IckbSdk } from "./sdk.js";

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
  it("uses explicit custom code outpoints instead of cellDep order", () => {
    const udt = script("11");
    const logic = script("22");
    const udtCode = outPoint("33");
    const logicCode = outPoint("44");
    const decoyDep = ccc.CellDep.from({
      outPoint: outPoint("55"),
      depType: "depGroup",
    });

    const { managers } = getConfig({
      udt: { script: udt, codeOutPoint: udtCode, cellDeps: [decoyDep] },
      logic: { script: logic, codeOutPoint: logicCode, cellDeps: [decoyDep] },
      ownedOwner: { script: script("66"), cellDeps: [decoyDep] },
      order: { script: script("77"), cellDeps: [decoyDep] },
      dao: { script: script("88"), cellDeps: [decoyDep] },
    });

    expect(managers.ickbUdt.udtCode.eq(udtCode)).toBe(true);
    expect(managers.ickbUdt.logicCode.eq(logicCode)).toBe(true);
    expect(managers.ickbUdt.script.eq(IckbUdt.typeScriptFrom(udt, logic))).toBe(true);
    expect(managers.logic.daoManager).toBe(managers.dao);
    expect(managers.ownedOwner.daoManager).toBe(managers.dao);
    expect(managers.order.udtScript.eq(managers.ickbUdt.script)).toBe(true);
  });

  it("builds the SDK from one coherent config object", async () => {
    const config = getConfig("testnet");
    const sdk = IckbSdk.fromConfig(config);
    const tx = ccc.Transaction.default();
    const signer = {} as ccc.Signer;
    const completeBy = vi.fn(async (
      txLike: ccc.TransactionLike,
    ): Promise<ccc.Transaction> => {
      await Promise.resolve();
      const completed = ccc.Transaction.from(txLike);
      completed.outputsData.push("0x01");
      return completed;
    });
    config.managers.ickbUdt.completeBy = completeBy;
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockResolvedValue([
      0,
      false,
    ]);
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);

    expect(sdk).toBeInstanceOf(IckbSdk);
    const completed = await sdk.completeTransaction(tx, {
      signer,
      client: {} as ccc.Client,
      feeRate: 1n,
    });

    expect(completeBy).toHaveBeenCalledWith(tx, signer);
    expect(completed.outputsData).toEqual(["0x01"]);
  });

  it("rejects custom config missing an explicit code outpoint", () => {
    const dep = ccc.CellDep.from({
      outPoint: outPoint("99"),
      depType: "depGroup",
    });

    expect(() => getConfig({
      udt: {
        script: script("11"),
        codeOutPoint: undefined as unknown as ccc.OutPointLike,
        cellDeps: [dep],
      },
      logic: {
        script: script("22"),
        codeOutPoint: outPoint("33"),
        cellDeps: [dep],
      },
      ownedOwner: { script: script("44"), cellDeps: [dep] },
      order: { script: script("55"), cellDeps: [dep] },
      dao: { script: script("66"), cellDeps: [dep] },
    })).toThrow("custom config missing xUDT code outPoint");
  });
});
