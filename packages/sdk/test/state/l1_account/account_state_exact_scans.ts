import { ccc } from "@ckb-ccc/core";
import { script, StubClient } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testSdk } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { baseTip, hash } from "../../transaction/base/support/sdk_core_support.ts";
import { none } from "./support/sdk_l1_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IckbSdk.getAccountState exact scans", () => {
  it("classifies one exact-lock scan and rejects typed prefix extensions", async () => {
    const { sdk, ickbUdt, logicManager, ownedOwnerManager } = testSdk();
    const lock = script("71");
    const extendedUdt = ccc.Script.from({
      codeHash: ickbUdt.script.codeHash,
      hashType: ickbUdt.script.hashType,
      args: `${ickbUdt.script.args}00`,
    });
    const capacity = cell("81", lock);
    const nativeUdt = cell(
      "82",
      lock,
      ickbUdt.script,
      ccc.hexFrom(ccc.numLeToBytes(7n, 16)),
    );
    const prefixExtension = cell(
      "83",
      lock,
      extendedUdt,
      ccc.hexFrom(ccc.numLeToBytes(9n, 16)),
    );
    vi.spyOn(logicManager, "findReceipts").mockImplementation(() => none());
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    const queries: ccc.ClientIndexerSearchKeyLike[] = [];
    const client = new StubClient({
      findCellsPagedNoCache: async (
        query,
      ): ReturnType<ccc.Client["findCellsPagedNoCache"]> => {
        queries.push(query);
        await Promise.resolve();
        return { cells: [capacity, nativeUdt, prefixExtension], lastCursor: "end" };
      },
    });

    const state = await sdk.getAccountState(client, [lock], baseTip);

    expect(state.capacityCells).toEqual([capacity]);
    expect(state.nativeUdtCells).toEqual([nativeUdt]);
    expect(state.nativeUdtBalance).toBe(7n);
    assertExactQueries(queries, lock);
  });
});

function assertExactQueries(
  queries: ccc.ClientIndexerSearchKeyLike[],
  lock: ccc.Script,
): void {
  expect(queries).toHaveLength(1);
  for (const query of queries) {
    expect(query.scriptSearchMode).toBe("exact");
    expect(ccc.Script.from(query.script).eq(lock)).toBe(true);
    expect(query.filter).toBeUndefined();
    expect(query.withData).toBe(true);
  }
}

function cell(
  byte: string,
  lock: ccc.Script,
  type?: ccc.Script,
  outputData: ccc.Hex = "0x",
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: { capacity: ccc.fixedPointFrom(100), lock, type },
    outputData,
  });
}
