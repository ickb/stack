import { ccc } from "@ckb-ccc/core";
import { script, StubClient } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IckbError } from "../../../src/sdk.ts";
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
    const pageSizes: number[] = [];
    const afters: Array<string | undefined> = [];
    const client = new StubClient({
      findCellsPaged: async (
        query,
        _order,
        pageSize,
        after,
      ): ReturnType<ccc.Client["findCellsPaged"]> => {
        queries.push(query);
        pageSizes.push(Number(pageSize ?? 0));
        afters.push(after);
        await Promise.resolve();
        if (after === undefined) {
          return { cells: [capacity], lastCursor: "account-1" };
        }
        if (after === "account-1") {
          return { cells: [nativeUdt], lastCursor: "account-2" };
        }
        return after === "account-2"
          ? { cells: [prefixExtension], lastCursor: "account-3" }
          : { cells: [], lastCursor: "account-end" };
      },
    });

    const state = await sdk.getAccountState(client, [lock], baseTip, {
      cellPageSize: 1,
    });

    expect(state.capacityCells).toEqual([capacity]);
    expect(state.nativeUdtCells).toEqual([nativeUdt]);
    expect(state.nativeUdtBalance).toBe(7n);
    expect(pageSizes).toEqual([1, 1, 1, 1]);
    expect(afters).toEqual([undefined, "account-1", "account-2", "account-3"]);
    assertExactQueries(queries, lock);
  });
});

describe("IckbSdk.getAccountState bounded scans", () => {
  it("derives the page budget from a caller's small page size", async () => {
    const { sdk, logicManager, ownedOwnerManager } = testSdk();
    const lock = script("71");
    const capacity = cell("81", lock);
    vi.spyOn(logicManager, "findReceipts").mockImplementation(() => none());
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    let calls = 0;
    const client = new StubClient({
      findCellsPaged: async (): ReturnType<ccc.Client["findCellsPaged"]> => {
        await Promise.resolve();
        calls += 1;
        return calls <= 65
          ? { cells: [capacity], lastCursor: `account-${String(calls)}` }
          : { cells: [], lastCursor: "account-end" };
      },
    });

    const state = await sdk.getAccountState(client, [lock], baseTip, {
      cellPageSize: 1,
    });

    expect(calls).toBe(66);
    expect(state.capacityCells).toEqual([capacity]);
  });

  it("maps an aborted aggregate scan to account_scan_limit", async () => {
    const { sdk, logicManager, ownedOwnerManager } = testSdk();
    const controller = new AbortController();
    controller.abort(new Error("preview expired"));
    vi.spyOn(logicManager, "findReceipts").mockImplementation(() => none());
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    const findCellsPaged = vi.fn();
    const client = new StubClient({ findCellsPaged });

    const result = sdk.getAccountState(client, [script("71")], baseTip, {
      signal: controller.signal,
    });
    await expect(result).rejects.toBeInstanceOf(IckbError);
    await expect(result).rejects.toMatchObject({
      name: "IckbError",
      code: "account_scan_limit",
      retryable: false,
    });
    expect(findCellsPaged).not.toHaveBeenCalled();
  });
});

function assertExactQueries(
  queries: ccc.ClientIndexerSearchKeyLike[],
  lock: ccc.Script,
): void {
  expect(queries).toHaveLength(4);
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
