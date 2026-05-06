import { ccc } from "@ckb-ccc/core";
import { Info, Ratio } from "@ickb/order";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DaoManager } from "@ickb/dao";
import {
  type IckbDepositCell,
  LogicManager,
  OwnedOwnerManager,
} from "@ickb/core";
import { OrderManager } from "@ickb/order";
import { IckbSdk, type SystemState } from "./sdk.js";

const ratio = Ratio.from({ ckbScale: 1n, udtScale: 1n });

function headerLike(
  number: bigint,
  overrides: Partial<ccc.ClientBlockHeader> = {},
): ccc.ClientBlockHeader {
  return ccc.ClientBlockHeader.from({
    compactTarget: 0n,
    dao: { c: 0n, ar: 1000n, s: 0n, u: 0n },
    epoch: [1n, 0n, 1n],
    extraHash: hash("aa"),
    hash: hash("bb"),
    nonce: 0n,
    number,
    parentHash: hash("cc"),
    proposalsHash: hash("dd"),
    timestamp: 0n,
    transactionsRoot: hash("ee"),
    version: 0n,
    ...overrides,
  });
}

const tip = headerLike(0n);

function hash(byte: string): `0x${string}` {
  return `0x${byte.repeat(32)}`;
}

function script(byte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: hash(byte),
    hashType: "type",
    args: "0x",
  });
}

async function* once<T>(value: T): AsyncGenerator<T> {
  yield value;
  await Promise.resolve();
}

async function* none<T>(): AsyncGenerator<T> {
  await Promise.resolve();
  yield* [] as T[];
}

function system(overrides: Partial<SystemState> = {}): SystemState {
  return {
    feeRate: 1n,
    tip,
    exchangeRatio: ratio,
    orderPool: [],
    ckbAvailable: 0n,
    ckbMaturing: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IckbSdk.estimate", () => {
  it("omits maturity below the fee threshold", () => {
    const result = IckbSdk.estimate(
      false,
      { ckbValue: 0n, udtValue: 100000n },
      system({ ckbAvailable: 100000n }),
    );

    expect(result.convertedAmount).toBe(99999n);
    expect(result.ckbFee).toBe(1n);
    expect(result.maturity).toBeUndefined();
  });

  it("uses the chain tip timestamp for preview maturity", () => {
    const result = IckbSdk.estimate(
      false,
      { ckbValue: 0n, udtValue: 1000000n },
      system({
        ckbAvailable: 1000000n,
        tip: headerLike(0n, { timestamp: 1234n }),
      }),
    );

    expect(result.convertedAmount).toBe(999990n);
    expect(result.ckbFee).toBe(10n);
    expect(result.maturity).toBe(601234n);
  });
});

describe("IckbSdk.maturity", () => {
  it("returns undefined for dual-ratio orders", () => {
    const dualRatio = new Info(ratio, ratio, 1);

    expect(
      IckbSdk.maturity(
        { info: dualRatio, amounts: { ckbValue: 1n, udtValue: 1n } },
        system(),
      ),
    ).toBeUndefined();
  });

  it("returns zero for already fulfilled orders", () => {
    expect(
      IckbSdk.maturity(
        {
          info: Info.create(true, ratio),
          amounts: { ckbValue: 0n, udtValue: 0n },
        },
        system(),
      ),
    ).toBe(0n);
  });

  it("returns the baseline maturity when enough CKB is already available", () => {
    expect(
      IckbSdk.maturity(
        {
          info: Info.create(false, ratio),
          amounts: { ckbValue: 0n, udtValue: 100n },
        },
        system({
          ckbAvailable: 100n,
          tip: headerLike(0n, { timestamp: 1234n }),
        }),
      ),
    ).toBe(601234n);
  });

  it("picks the first matching maturing CKB entry", () => {
    expect(
      IckbSdk.maturity(
        {
          info: Info.create(false, ratio),
          amounts: { ckbValue: 0n, udtValue: 100n },
        },
        system({
          ckbMaturing: [
            { ckbCumulative: 50n, maturity: 1000n },
            { ckbCumulative: 100n, maturity: 2000n },
            { ckbCumulative: 150n, maturity: 3000n },
          ],
        }),
      ),
    ).toBe(2000n);
  });
});

describe("IckbSdk.getL1State snapshot detection", () => {
  it("ignores bot data cells and falls back to direct deposit scanning", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const sdk = new IckbSdk(
      new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, [])),
      new LogicManager(logic, [], new DaoManager(dao, [])),
      new OrderManager(order, [], udt),
      [botLock],
    );
    const fakeAlignedData = ccc.hexFrom(new Uint8Array(128).fill(0xaa));
    const header = headerLike(1n);
    const botCells = [
      ccc.Cell.from({
        outPoint: { txHash: hash("01"), index: 0n },
        cellOutput: { capacity: 1000n, lock: botLock },
        outputData: fakeAlignedData,
      }),
    ];
    const depositCell = ccc.Cell.from({
      outPoint: { txHash: hash("02"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: logic,
        type: dao,
      },
      outputData: DaoManager.depositData(),
    });
    const client = {
      getTipHeader: () => Promise.resolve(header),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: async function* (query: {
        scriptType?: string;
        filter?: { outputData?: ccc.Hex };
      }) {
        if (query.filter?.outputData === DaoManager.depositData()) {
          yield depositCell;
        }
        if (query.scriptType === "lock") {
          for (const cell of botCells) {
            yield cell;
          }
        }
        await Promise.resolve();
      },
      getTransactionWithHeader: (txHash: ccc.Hex) => Promise.resolve({
        header: txHash === hash("02")
          ? headerLike(0n)
          : headerLike(1n, { epoch: ccc.Epoch.from([2n, 0n, 1n]) }),
      }),
    } as unknown as ccc.Client;

    const state = await sdk.getL1State(client, []);

    expect(state.user.orders).toEqual([]);
    expect(state.system.ckbMaturing).toHaveLength(1);
    expect(state.system.ckbMaturing[0]?.ckbCumulative).toBe(
      ccc.fixedPointFrom(100082),
    );
  });

  it("treats ready deposits as available CKB instead of future maturity", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const daoManager = new DaoManager(dao, []);
    const logicManager = new LogicManager(logic, [], daoManager);
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], daoManager);
    const readyDeposit = {
      cell: ccc.Cell.from({
        outPoint: { txHash: hash("03"), index: 0n },
        cellOutput: {
          capacity: ccc.fixedPointFrom(100082),
          lock: logic,
          type: dao,
        },
        outputData: DaoManager.depositData(),
      }),
      isDeposit: true,
      headers: [{ header: headerLike(0n) }, { header: headerLike(0n) }],
      interests: 0n,
      maturity: ccc.Epoch.from([1n, 0n, 1n]),
      isReady: true,
      ckbValue: ccc.fixedPointFrom(100082),
      udtValue: ccc.fixedPointFrom(100000),
    } as IckbDepositCell;
    const findDeposits = vi.spyOn(logicManager, "findDeposits").mockImplementation(() => once(readyDeposit));
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    const sdk = new IckbSdk(
      ownedOwnerManager,
      logicManager,
      new OrderManager(order, [], udt),
      [botLock],
    );
    const tip = headerLike(1n, { epoch: ccc.Epoch.from([181n, 0n, 1n]) });
    const client = {
      getTipHeader: () => Promise.resolve(tip),
      getFeeRate: () => Promise.resolve(1n),
      findCellsOnChain: () => none(),
      getTransactionWithHeader: () => Promise.resolve({ header: headerLike(0n) }),
    } as unknown as ccc.Client;

    const state = await sdk.getL1State(client, []);

    expect(findDeposits).toHaveBeenCalled();
    expect(state.system.ckbAvailable).toBe(ccc.fixedPointFrom(100082));
    expect(state.system.ckbMaturing).toEqual([]);
  });
});
