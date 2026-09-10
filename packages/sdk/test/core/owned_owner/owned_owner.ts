import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnerCell } from "../../../src/core/cells.ts";
import { OwnerData } from "../../../src/core/entities.ts";
import { OwnedOwnerManager } from "../../../src/core/owned_owner.ts";
import { DaoManager } from "../../../src/dao/index.ts";
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
  registerOwnerFilterTests();
});

function registerOwnerDecodingTests(): void {
  it("matches the deployed owner data wire format", () => {
    const encoded = OwnerData.from({ ownedDistance: -5n }).toBytes();

    expect(encoded).toHaveLength(4);
    expect(ccc.hexFrom(encoded)).toBe("0xfbffffff");
    expect(OwnerData.decodePrefix("0xfbffffffaabbcc").ownedDistance).toBe(-5n);
  });

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

function registerOwnerFilterTests(): void {
  it("recognizes owner markers by owner type and decodable data", async () => {
    const ownerLock = script("11");
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
    const wrongTypeOwner = ownerCell("88", ownerLock, script("44"));
    const impossibleOwner = ccc.Cell.from({
      outPoint: { txHash: `0x${"99".repeat(32)}`, index: 0n },
      cellOutput: { capacity: 61n, lock: ownerLock, type: ownedOwnerScript },
      outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
    });
    const client = new StubClient({
      getCell: async (): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        return undefined;
      },
    });

    expect(manager.isOwner(matchingOwner)).toBe(true);
    expect(manager.isOwner(shortDataOwner)).toBe(false);
    expect(manager.isOwner(impossibleOwner)).toBe(false);

    const groups = await manager.withdrawalGroupsFrom(
      client,
      [matchingOwner, shortDataOwner, wrongTypeOwner, impossibleOwner],
      headerLike(),
    );

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
