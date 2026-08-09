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
  it("separates capacity and native iCKB scans and rejects prefix extensions", async () => {
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
    const pageSizes: number[] = [];
    const afters = new Map<"capacity" | "udt", Array<string | undefined>>();
    const client = new StubClient({
      findCellsPaged: async (
        query,
        _order,
        pageSize,
        after,
      ): ReturnType<ccc.Client["findCellsPaged"]> => {
        queries.push(query);
        pageSizes.push(Number(pageSize ?? 0));
        const scan = query.filter?.script === undefined ? "capacity" : "udt";
        const scanAfters = afters.get(scan) ?? [];
        scanAfters.push(after);
        afters.set(scan, scanAfters);
        await Promise.resolve();
        if (scan === "capacity") {
          return after === undefined
            ? { cells: [capacity], lastCursor: "capacity-1" }
            : { cells: [], lastCursor: "capacity-end" };
        }

        if (after === undefined) {
          return { cells: [nativeUdt], lastCursor: "udt-1" };
        }
        return after === "udt-1"
          ? { cells: [prefixExtension], lastCursor: "udt-2" }
          : { cells: [], lastCursor: "udt-end" };
      },
    });

    const state = await sdk.getAccountState(client, [lock], baseTip, {
      cellPageSize: 1,
    });

    expect(state.capacityCells).toEqual([capacity]);
    expect(state.nativeUdtCells).toEqual([nativeUdt]);
    expect(state.nativeUdtBalance).toBe(7n);
    expect(pageSizes).toEqual([1, 1, 1, 1, 1]);
    expect(afters).toEqual(
      new Map([
        ["capacity", [undefined, "capacity-1"]],
        ["udt", [undefined, "udt-1", "udt-2"]],
      ]),
    );
    assertExactQueries(queries, lock, ickbUdt.script);
  });
});

function assertExactQueries(
  queries: ccc.ClientIndexerSearchKeyLike[],
  lock: ccc.Script,
  udt: ccc.Script,
): void {
  expect(queries).toHaveLength(5);
  for (const query of queries) {
    expect(query.scriptSearchMode).toBe("exact");
    expect(ccc.Script.from(query.script).eq(lock)).toBe(true);
  }
  expect(queries[0]?.filter).toMatchObject({
    scriptLenRange: [0n, 1n],
    outputDataLenRange: [0n, 1n],
  });
  expect(queries[1]?.filter).toMatchObject({
    script: udt,
    scriptLenRange: [BigInt(udt.occupiedSize), BigInt(udt.occupiedSize) + 1n],
  });
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
