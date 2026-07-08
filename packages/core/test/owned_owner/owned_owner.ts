import { ccc } from "@ckb-ccc/core";
import { DaoManager } from "@ickb/dao";
import { collect } from "@ickb/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnerCell } from "../../src/cells.ts";
import { OwnerData } from "../../src/entities.ts";
import { OwnedOwnerManager } from "../../src/owned_owner.ts";
import {
  FIND_WITHDRAWAL_GROUPS_SUITE,
  headerLike,
  script,
  StubClient,
} from "./support/owned_owner_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(FIND_WITHDRAWAL_GROUPS_SUITE, () => {
  registerOwnerDecodingTests();
  registerOwnerPageSizeTests();
  registerOwnerFilterTests();
});

function registerOwnerDecodingTests(): void {
  it("decodes owner relative distances from prefixed data", () => {
    const ownerCell = new OwnerCell(
      ccc.Cell.from({
        outPoint: { txHash: `0x${"55".repeat(32)}`, index: 1n },
        cellOutput: { capacity: 61n, lock: script("11"), type: script("22") },
        outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
      }),
    );

    expect(ownerCell.getOwned().index).toBe(0n);
  });
}

function registerOwnerPageSizeTests(): void {
  it("passes the cell page size to owner scanning", async () => {
    const ownerLock = script("11");
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const tip = headerLike();
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const firstOwner = ownerCell("55", ownerLock, ownedOwnerScript);
    const secondOwner = ownerCell("66", ownerLock, ownedOwnerScript);
    let requestedPageSize = 0;
    const client = new StubClient({
      async *findCells(
        _query,
        _order,
        pageSize = 10,
      ): ReturnType<ccc.Client["findCells"]> {
        requestedPageSize = pageSize;
        await Promise.resolve();
        yield firstOwner;
        yield secondOwner;
      },
      getCell: async (): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        return undefined;
      },
    });

    const groups = await collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip, pageSize: 1 }),
    );

    expect(requestedPageSize).toBe(1);
    expect(groups).toEqual([]);
  });
}

function registerOwnerFilterTests(): void {
  it("filters owners by owner type, owner lock, and scan mode", async () => {
    const ownerLock = script("11");
    const otherLock = script("12");
    const ownedOwnerScript = script("22");
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(script("33"), []),
    );
    const matchingOwner = ownerCell("55", ownerLock, ownedOwnerScript);
    const shortDataOwner = ccc.Cell.from({
      outPoint: { txHash: `0x${"66".repeat(32)}`, index: 1n },
      cellOutput: { capacity: 61n, lock: ownerLock, type: ownedOwnerScript },
      outputData: "0x00",
    });
    const wrongLockOwner = ownerCell("77", otherLock, ownedOwnerScript);
    const wrongTypeOwner = ownerCell("88", ownerLock, script("44"));
    const impossibleOwner = ccc.Cell.from({
      outPoint: { txHash: `0x${"99".repeat(32)}`, index: 0n },
      cellOutput: { capacity: 61n, lock: ownerLock, type: ownedOwnerScript },
      outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
    });
    let onChainPageSize = 0;
    const client = new StubClient({
      getTipHeader: async (): ReturnType<ccc.Client["getTipHeader"]> => {
        await Promise.resolve();
        return headerLike();
      },
      async *findCellsOnChain(
        _query,
        _order,
        pageSize = 10,
      ): ReturnType<ccc.Client["findCellsOnChain"]> {
        onChainPageSize = pageSize;
        await Promise.resolve();
        yield matchingOwner;
        yield shortDataOwner;
        yield wrongLockOwner;
        yield wrongTypeOwner;
        yield impossibleOwner;
      },
      getCell: async (): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        return undefined;
      },
    });

    expect(manager.isOwner(matchingOwner)).toBe(true);
    expect(manager.isOwner(shortDataOwner)).toBe(false);
    expect(manager.isOwner(impossibleOwner)).toBe(false);

    const groups = await collect(
      manager.findWithdrawalGroups(client, [ownerLock, ownerLock], {
        onChain: true,
        pageSize: 3,
      }),
    );

    expect(onChainPageSize).toBe(3);
    expect(groups).toEqual([]);
  });
}

function ownerCell(
  txHashByte: string,
  ownerLock: ccc.Script,
  ownedOwnerScript: ccc.Script,
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: `0x${txHashByte.repeat(32)}`, index: 1n },
    cellOutput: { capacity: 61n, lock: ownerLock, type: ownedOwnerScript },
    outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
  });
}
