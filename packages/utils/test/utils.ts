import { ccc } from "@ckb-ccc/core";
import { FakeCkbSigner } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import {
  asyncBinarySearch,
  binarySearch,
  collect,
  collectCellsPaged,
  collectPagedScan,
  compareBigInt,
  defaultCellPageSize,
  defaultScanBudget,
  defaultScanItemLimit,
  findSignerCellsPagedNoCache,
  isPlainCapacityCell,
  PagedScanBudget,
  PagedScanBudgetError,
  PagedScanCursorError,
  pagedScanCursorErrorCode,
  type PagedScanSignal,
  unique,
} from "../src/utils.ts";

const invalidRpcUrl = "https://example.invalid";

describe("compareBigInt", () => {
  it("orders bigint values", () => {
    expect(compareBigInt(1n, 2n)).toBe(-1);
    expect(compareBigInt(2n, 2n)).toBe(0);
    expect(compareBigInt(3n, 2n)).toBe(1);
  });
});

describe("scan collection", () => {
  it("completes after an empty page", async () => {
    const fetchPage = vi.fn(async () => {
      await Promise.resolve();
      return { items: new Array<number>(), lastCursor: "ignored" };
    });

    await expect(collectPagedScan(fetchPage, { pageSize: 2 })).resolves.toEqual([]);
    expect(fetchPage).toHaveBeenCalledWith(2, undefined);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("completes after a short page without requiring a cursor", async () => {
    const fetchPage = vi.fn(async () => {
      await Promise.resolve();
      return { cells: [1] };
    });

    await expect(collectPagedScan(fetchPage, { pageSize: 2 })).resolves.toEqual([1]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("collects every advancing page without a total item or page cap", async () => {
    const afters: Array<string | undefined> = [];
    const fetchPage = vi.fn(async (pageSize: number, after: string | undefined) => {
      await Promise.resolve();
      afters.push(after);
      const page = after === undefined ? 0 : Number(after);
      return page < 5
        ? {
            items: [page * pageSize, page * pageSize + 1],
            lastCursor: String(page + 1),
          }
        : { items: [page * pageSize] };
    });

    await expect(collectPagedScan(fetchPage, { pageSize: 2 })).resolves.toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(afters).toEqual([undefined, "1", "2", "3", "4", "5"]);
  });

  it("rejects a full page with a missing cursor", async () => {
    const promise = collectPagedScan(
      async () => {
        await Promise.resolve();
        return { items: [1, 2] };
      },
      { pageSize: 2 },
    );

    await expect(promise).rejects.toBeInstanceOf(PagedScanCursorError);
    await expect(promise).rejects.toMatchObject({
      code: pagedScanCursorErrorCode,
      previousCursor: undefined,
      lastCursor: undefined,
    });
  });

  it("rejects a full page with an unchanged cursor", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1], lastCursor: "same" })
      .mockResolvedValueOnce({ items: [2], lastCursor: "same" });

    await expect(collectPagedScan(fetchPage, { pageSize: 1 })).rejects.toMatchObject({
      name: "PagedScanCursorError",
      code: pagedScanCursorErrorCode,
      previousCursor: "same",
      lastCursor: "same",
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("rejects a full page that returns any previously observed cursor", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1], lastCursor: "a" })
      .mockResolvedValueOnce({ items: [2], lastCursor: "b" })
      .mockResolvedValueOnce({ items: [3], lastCursor: "a" });

    await expect(collectPagedScan(fetchPage, { pageSize: 1 })).rejects.toMatchObject({
      name: "PagedScanCursorError",
      code: pagedScanCursorErrorCode,
      previousCursor: "b",
      lastCursor: "a",
    });
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});

describe("bounded scan collection", () => {
  it("shares one item budget across collectors", async () => {
    const budget = new PagedScanBudget(3, 10);
    const first = vi
      .fn()
      .mockResolvedValueOnce({ items: [1, 2], lastCursor: "first" })
      .mockResolvedValueOnce({ items: [3] });
    const second = vi.fn().mockResolvedValue({ items: [4, 5] });

    await expect(collectPagedScan(first, { pageSize: 2, budget })).resolves.toEqual([
      1, 2, 3,
    ]);
    await expect(collectPagedScan(second, { pageSize: 2, budget })).rejects.toMatchObject(
      {
        name: "PagedScanBudgetError",
        reason: "items",
        items: 3,
        pages: 3,
      },
    );
    expect(second).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid page item count %s",
    (count) => {
      const budget = new PagedScanBudget(10, 10);

      expect(() => {
        budget.addItems(count);
      }).toThrow("Paged scan item count must be a non-negative safe integer");
    },
  );

  it("fails closed before requesting a page beyond the shared page budget", async () => {
    const budget = new PagedScanBudget(10, 1);
    const fetchPage = vi.fn().mockResolvedValue({ items: [1], lastCursor: "next" });

    await expect(
      collectPagedScan(fetchPage, { pageSize: 1, budget }),
    ).rejects.toBeInstanceOf(PagedScanBudgetError);
    await expect(
      collectPagedScan(fetchPage, { pageSize: 1, budget }),
    ).rejects.toMatchObject({ reason: "pages", items: 1, pages: 1 });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe("bounded scan cancellation", () => {
  it("does not call the page fetcher when an aggregate scan is already aborted", async () => {
    const signal: PagedScanSignal = {
      aborted: true,
      reason: new Error("deadline"),
    };
    const budget = new PagedScanBudget(10, 10, signal);
    const fetchPage = vi.fn().mockResolvedValue({ items: [] });

    await expect(
      collectPagedScan(fetchPage, { pageSize: 1, budget }),
    ).rejects.toMatchObject({ name: "PagedScanBudgetError", reason: "aborted" });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("converts a page failure to an abort when cancellation fires in flight", async () => {
    const signal: { aborted: boolean; reason?: unknown } = { aborted: false };
    const budget = new PagedScanBudget(10, 10, signal);
    const transportError = new Error("late transport failure");

    const scan = collectPagedScan(
      async () => {
        await Promise.resolve();
        signal.aborted = true;
        signal.reason = new Error("preview expired");
        throw transportError;
      },
      { pageSize: 1, budget },
    );

    await expect(scan).rejects.toMatchObject({
      name: "PagedScanBudgetError",
      reason: "aborted",
      cause: transportError,
    });
  });

  it("preserves a page failure when the scan signal remains active", async () => {
    const failure = new Error("page failed");
    const budget = new PagedScanBudget(10, 10, { aborted: false });

    await expect(
      collectPagedScan(
        async () => {
          await Promise.resolve();
          throw failure;
        },
        { pageSize: 1, budget },
      ),
    ).rejects.toBe(failure);
  });

  it("preserves a page failure when no budget owns cancellation", async () => {
    const failure = new Error("page failed");

    await expect(
      collectPagedScan(
        async () => {
          await Promise.resolve();
          throw failure;
        },
        { pageSize: 1 },
      ),
    ).rejects.toBe(failure);
  });
});

describe("scan validation", () => {
  it("rejects invalid page sizes before calling the page fetcher", async () => {
    const fetchPage = vi.fn(async () => {
      await Promise.resolve();
      return { items: new Array<number>() };
    });

    for (const pageSize of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(collectPagedScan(fetchPage, { pageSize })).rejects.toThrow(
        "pageSize must be a positive safe integer",
      );
    }
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("validates a CCC scan before cache or RPC access", async () => {
    const client = new ccc.ClientPublicTestnet({ url: invalidRpcUrl });
    const cacheScan = vi.spyOn(client.cache, "findCells");
    const rpc = vi.spyOn(client, "findCellsPaged");

    await expect(
      collectCellsPaged(
        client,
        {
          script: testCell({ type: undefined, outputData: "0x" }).cellOutput.lock,
          scriptType: "lock",
          scriptSearchMode: "exact",
        },
        "asc",
        { onChain: false, pageSize: 0 },
      ),
    ).rejects.toThrow("pageSize must be a positive safe integer");
    expect(cacheScan).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("default scan budget", () => {
  it("bounds page requests absolutely when empty lock scans outnumber the allowance", async () => {
    // Each empty lock scan spends exactly one page, so the request count would
    // grow with the lock count if the allowance still derived from scan count.
    const { pages, scan } = emptyPageSignerScan(4_096);

    await expect(scan).rejects.toMatchObject({
      name: "PagedScanBudgetError",
      reason: "pages",
    });
    expect(pages()).toBe(2 * (defaultScanItemLimit / defaultCellPageSize));
  });

  it("completes a normal multi-lock signer scan within the page allowance", async () => {
    const { pages, scan } = emptyPageSignerScan(8);

    await expect(scan).resolves.toEqual([]);
    expect(pages()).toBe(8);
  });

  it("still completes the pages a full item budget spends", async () => {
    const budget = defaultScanBudget({ pageSize: defaultCellPageSize });
    const fetchPage = vi.fn(async (pageSize: number, after: string | undefined) => {
      await Promise.resolve();
      const page = after === undefined ? 0 : Number(after);
      return {
        items: Array.from({ length: pageSize }, () => page),
        lastCursor: String(page + 1),
      };
    });

    await expect(
      collectPagedScan(fetchPage, { pageSize: defaultCellPageSize, budget }),
    ).rejects.toMatchObject({ reason: "items", items: defaultScanItemLimit });
    expect(fetchPage).toHaveBeenCalledTimes(
      defaultScanItemLimit / defaultCellPageSize + 1,
    );
  });
});

describe("CCC cached scans", () => {
  it("merges cached cells with distinct usable on-chain cells", async () => {
    const client = new ccc.ClientPublicTestnet({ url: invalidRpcUrl });
    const cached = testCell({ type: undefined, outputData: "0x" });
    const fresh = testCell({ type: undefined, outputData: "0x", txByte: "33" });
    vi.spyOn(client.cache, "findCells").mockImplementation(async function* () {
      await Promise.resolve();
      yield cached;
    });
    vi.spyOn(client.cache, "isUnusable").mockResolvedValue(false);
    vi.spyOn(client, "findCellsPaged").mockResolvedValue({
      cells: [cached, fresh],
      lastCursor: "done",
    });

    await expect(
      collectCellsPaged(
        client,
        {
          script: cached.cellOutput.lock,
          scriptType: "lock",
          scriptSearchMode: "exact",
        },
        "asc",
        { onChain: false, pageSize: 3 },
      ),
    ).resolves.toEqual([cached, fresh]);
  });
});

describe("CCC cached scan budget", () => {
  it("charges cached cells to the shared budget and fails before any RPC page", async () => {
    const client = new ccc.ClientPublicTestnet({ url: invalidRpcUrl });
    const cached = testCell({ type: undefined, outputData: "0x" });
    vi.spyOn(client.cache, "findCells").mockImplementation(async function* () {
      await Promise.resolve();
      for (let index = 0; index <= defaultScanItemLimit; index += 1) {
        yield cached;
      }
    });
    const rpc = vi.spyOn(client, "findCellsPaged");

    await expect(
      collectCellsPaged(client, cachedScanKey(cached), "asc", {
        onChain: false,
        pageSize: 400,
        budget: defaultScanBudget({ pageSize: 400 }),
      }),
    ).rejects.toBeInstanceOf(PagedScanBudgetError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("bounds a nonterminating cache iterator before any RPC page", async () => {
    const client = new ccc.ClientPublicTestnet({ url: invalidRpcUrl });
    const cached = testCell({ type: undefined, outputData: "0x" });
    vi.spyOn(client.cache, "findCells").mockImplementation(async function* () {
      for (;;) {
        await Promise.resolve();
        yield cached;
      }
    });
    const rpc = vi.spyOn(client, "findCellsPaged");

    await expect(
      collectCellsPaged(client, cachedScanKey(cached), "asc", {
        onChain: false,
        pageSize: 3,
        budget: new PagedScanBudget(5, 5),
      }),
    ).rejects.toBeInstanceOf(PagedScanBudgetError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("leaves cached scans unbounded when no budget is supplied", async () => {
    const client = new ccc.ClientPublicTestnet({ url: invalidRpcUrl });
    const cached = testCell({ type: undefined, outputData: "0x" });
    vi.spyOn(client.cache, "findCells").mockImplementation(async function* () {
      await Promise.resolve();
      for (let index = 0; index <= defaultScanItemLimit; index += 1) {
        yield cached;
      }
    });
    vi.spyOn(client.cache, "isUnusable").mockResolvedValue(false);
    vi.spyOn(client, "findCellsPaged").mockResolvedValue({
      cells: [],
      lastCursor: "done",
    });

    await expect(
      collectCellsPaged(client, cachedScanKey(cached), "asc", {
        onChain: false,
        pageSize: 400,
      }),
    ).resolves.toHaveLength(defaultScanItemLimit + 1);
  });
});

describe("CCC committed scans", () => {
  it("uses the no-cache page method without invoking the recording wrapper", async () => {
    const client = new ccc.ClientPublicTestnet({ url: invalidRpcUrl });
    const cell = testCell({ type: undefined, outputData: "0x" });
    const noCache = vi.spyOn(client, "findCellsPagedNoCache").mockResolvedValue({
      cells: [cell],
      lastCursor: "done",
    });
    const recording = vi
      .spyOn(client, "findCellsPaged")
      .mockRejectedValue(new Error("cache-recording scan used"));

    await expect(
      collectCellsPaged(
        client,
        {
          script: cell.cellOutput.lock,
          scriptType: "lock",
          scriptSearchMode: "exact",
        },
        "asc",
        { onChain: true, pageSize: 3 },
      ),
    ).resolves.toEqual([cell]);
    expect(noCache).toHaveBeenCalledTimes(1);
    expect(recording).not.toHaveBeenCalled();
  });
});

describe("async iterable collection", () => {
  it("collects async iterable values", async () => {
    await expect(
      collect(
        (async function* (): AsyncGenerator<string> {
          yield "a";
          await Promise.resolve();
          yield "b";
        })(),
      ),
    ).resolves.toEqual(["a", "b"]);
  });
});

describe("isPlainCapacityCell", () => {
  it("accepts cells without a type script or data", () => {
    const cell = testCell({ type: undefined, outputData: "0x" });

    expect(isPlainCapacityCell(cell)).toBe(true);
  });

  it("rejects typed cells and data-carrying cells", () => {
    const typed = testCell({
      type: { codeHash: "0x", hashType: "type", args: "0x" },
      outputData: "0x",
    });
    const dataCarrying = testCell({ type: undefined, outputData: "0x01" });

    expect(isPlainCapacityCell(typed)).toBe(false);
    expect(isPlainCapacityCell(dataCarrying)).toBe(false);
  });
});

describe("binary search helpers", () => {
  it("finds the first matching index", () => {
    expect(binarySearch(8, (index) => index >= 5)).toBe(5);
  });

  it("returns the range end when no index matches", () => {
    expect(binarySearch(4, () => false)).toBe(4);
  });

  it("finds the first matching index asynchronously", async () => {
    await expect(
      asyncBinarySearch(8, async (index) => {
        await Promise.resolve();
        return index >= 3;
      }),
    ).resolves.toBe(3);
  });
});

describe("unique", () => {
  it("yields only the first entity for each hex key", () => {
    const first = hexEntity("0x01");
    const duplicate = hexEntity("0x01");
    const second = hexEntity("0x02");

    expect([...unique([first, duplicate, second])]).toEqual([first, second]);
  });
});

/** Scans a signer owning `lockCount` distinct locks whose pages are all empty. */
function emptyPageSignerScan(lockCount: number): {
  pages: () => number;
  scan: Promise<ccc.Cell[]>;
} {
  const client = new ccc.ClientPublicTestnet({ url: invalidRpcUrl });
  let pages = 0;
  vi.spyOn(client, "findCellsPagedNoCache").mockImplementation(async () => {
    await Promise.resolve();
    pages += 1;
    return { cells: [], lastCursor: "" };
  });
  const scan = collect(
    findSignerCellsPagedNoCache(
      new FakeCkbSigner(
        client,
        Array.from({ length: lockCount }, (_unused, index) =>
          ccc.Script.from({
            codeHash: `0x${"22".repeat(32)}`,
            hashType: "type",
            args: ccc.numToHex(index),
          }),
        ),
      ),
      {},
      { pageSize: defaultCellPageSize },
    ),
  );
  return { pages: (): number => pages, scan };
}

function testCell({
  type,
  outputData,
  txByte = "11",
}: {
  type: ccc.ScriptLike | undefined;
  outputData: ccc.Hex;
  txByte?: string;
}): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: `0x${txByte.repeat(32)}`, index: 0n },
    cellOutput: {
      capacity: 0n,
      lock: { codeHash: `0x${"22".repeat(32)}`, hashType: "type", args: "0x" },
      type,
    },
    outputData,
  });
}

function cachedScanKey(cell: ccc.Cell): ccc.ClientIndexerSearchKeyLike {
  return {
    script: cell.cellOutput.lock,
    scriptType: "lock",
    scriptSearchMode: "exact",
  };
}

function hexEntity(value: ccc.Hex): ccc.Entity {
  return new TestEntity(value);
}

class TestEntity extends ccc.Entity {
  private readonly value: ccc.Hex;

  constructor(value: ccc.Hex) {
    super();
    this.value = value;
  }

  public override hash(): ccc.Hex {
    return ccc.hashCkb(this.value);
  }

  public override toBytes(): ccc.Bytes {
    return ccc.bytesFrom(this.value);
  }

  public override toHex(): ccc.Hex {
    return this.value;
  }

  public override clone(): TestEntity {
    return new TestEntity(this.value);
  }
}
