import { ccc } from "@ckb-ccc/core";
import {
  asyncPassthroughTransaction,
  FakeCkbSigner,
  passthroughTransaction,
  script,
  StubClient,
} from "@ickb/testkit";
import { expect, vi, type MockInstance } from "vitest";
import {
  ICKB_DEPOSIT_CAP,
  IckbUdt,
  LogicManager,
  OwnedOwnerManager,
  type IckbDepositCell,
} from "../../../../src/core/index.ts";
import { DaoManager } from "../../../../src/dao/index.ts";
import { OrderManager, type Ratio } from "../../../../src/order/index.ts";
import { IckbSdk } from "../../../../src/sdk.ts";
import {
  baseClient,
  conversionContext,
  hash,
} from "../../../transaction/base/support/sdk_core_support.ts";

export {
  BUILD_BASE_TRANSACTION_SUITE,
  BUILD_CONVERSION_TRANSACTION_SUITE,
} from "../../../transaction/complete/support/sdk_suite_titles.ts";

interface WithdrawalRemainderOrderMocks {
  mint: MockInstance<OrderManager["mint"]>;
  requestWithdrawal: MockInstance<OwnedOwnerManager["requestWithdrawal"]>;
}

const ICKB_TO_CKB = "ickb-to-ckb";
const DIRECT_PLUS_ORDER = "direct-plus-order";

export function baseTransactionFixture(
  options: {
    completion?: "passthrough" | "real";
    daoDeps?: ccc.CellDep[];
    logicDeps?: ccc.CellDep[];
    orderDeps?: ccc.CellDep[];
    ownedOwnerDeps?: ccc.CellDep[];
  } = {},
): BaseTransactionFixture {
  const botLock = script("11");
  const logic = script("22");
  const dao = script("33");
  const ownedOwner = script("44");
  const order = script("55");
  const udt = script("66");
  const daoManager = new DaoManager(dao, options.daoDeps ?? []);
  const logicManager = new LogicManager(logic, options.logicDeps ?? [], daoManager);
  const ownedOwnerManager = new OwnedOwnerManager(
    ownedOwner,
    options.ownedOwnerDeps ?? [],
    daoManager,
  );
  const orderManager = new OrderManager(order, options.orderDeps ?? [], udt);
  return {
    botLock,
    dao,
    logic,
    logicManager,
    order,
    orderManager,
    ownedOwner,
    ownedOwnerManager,
    sdk: withCompletion(
      new IckbSdk({
        ickbUdt: fakeIckbUdt(udt),
        ownedOwner: ownedOwnerManager,
        ickbLogic: logicManager,
        order: orderManager,
        bots: [botLock],
      }),
      options.completion,
    ),
    udt,
  };
}

function withCompletion(
  sdk: IckbSdk,
  completion: "passthrough" | "real" = "passthrough",
): IckbSdk {
  if (completion === "passthrough") {
    vi.spyOn(sdk, "completeTransaction").mockImplementation(asyncPassthroughTransaction);
  }
  return sdk;
}

export interface BaseTransactionFixture {
  botLock: ccc.Script;
  dao: ccc.Script;
  logic: ccc.Script;
  logicManager: LogicManager;
  order: ccc.Script;
  orderManager: OrderManager;
  ownedOwner: ccc.Script;
  ownedOwnerManager: OwnedOwnerManager;
  sdk: IckbSdk;
  udt: ccc.Script;
}

/**
 * SDK over fake managers. Completion is a passthrough unless `completion: "real"`, so
 * planning tests see the built transaction and walk tests see the real completer.
 */
export function testSdk(
  options: { completion?: "passthrough" | "real" } = {},
): SdkFixture {
  const lock = script("11");
  const logicManager = new LogicManager(
    script("22"),
    [],
    new DaoManager(script("33"), []),
  );
  const ownedOwnerManager = new OwnedOwnerManager(
    script("44"),
    [],
    new DaoManager(script("33"), []),
  );
  const orderManager = new OrderManager(script("55"), [], script("66"));
  const ickbUdt = fakeIckbUdt();
  const sdk = new IckbSdk({
    ickbUdt,
    ownedOwner: ownedOwnerManager,
    ickbLogic: logicManager,
    order: orderManager,
    bots: [],
  });
  withCompletion(sdk, options.completion);
  return { sdk, ickbUdt, logicManager, ownedOwnerManager, orderManager, lock };
}

/** Signer for planning tests; completion is a passthrough, so it never scans. */
export const stubSigner: ccc.Signer = new ccc.SignerCkbScriptReadonly(
  baseClient,
  script("11"),
);

/** Signer whose client serves the given committed cells to the real completer. */
export function fundedSigner(
  cells: readonly ccc.Cell[],
  locks: readonly ccc.Script[],
): { client: StubClient; signer: ccc.Signer } {
  const client = new StubClient({
    findCellsPaged: async (): ReturnType<ccc.Client["findCellsPaged"]> => {
      await Promise.resolve();
      throw new Error("Completion must not use CCC's cache-recording cell scan");
    },
    findCellsPagedNoCache: async (
      keyLike,
      _order,
      _limit,
      after,
    ): ReturnType<ccc.Client["findCellsPagedNoCache"]> => {
      await Promise.resolve();
      const { script: lock } = ccc.ClientIndexerSearchKey.from(keyLike);
      return {
        cells:
          after === undefined
            ? cells.filter((cell) => cell.cellOutput.lock.eq(lock))
            : [],
        lastCursor: after === undefined ? "test:end" : "test:done",
      };
    },
  });
  return { client, signer: new FakeCkbSigner(client, [...locks]) };
}

export interface SdkFixture {
  sdk: IckbSdk;
  ickbUdt: ReturnType<typeof fakeIckbUdt>;
  logicManager: LogicManager;
  ownedOwnerManager: OwnedOwnerManager;
  orderManager: OrderManager;
  lock: ccc.Script;
}

export function fakeIckbUdt(udt = script("66")): IckbUdt {
  return new TestIckbUdt(udt);
}

export function signerWithLock(lock: ccc.Script): ccc.Signer {
  return new TestSigner(undefined, lock);
}

class TestSigner extends ccc.SignerCkbScriptReadonly {
  public override sendTransaction: ccc.Signer["sendTransaction"];

  constructor(
    sendTransaction: ccc.Signer["sendTransaction"] = defaultSendTransaction,
    lock = script("11"),
  ) {
    super(baseClient, lock);
    this.sendTransaction = sendTransaction;
  }
}

async function defaultSendTransaction(): Promise<
  Awaited<ReturnType<ccc.Signer["sendTransaction"]>>
> {
  await Promise.resolve();
  return hash("ff");
}

export function mockPassthroughMint(orderManager: OrderManager): void {
  vi.spyOn(orderManager, "mint").mockImplementation(passthroughTransaction);
}

export async function expectIckbToCkbDirectPlusOrder(options: {
  sdk: IckbSdk;
  lock: ccc.Script;
  deposits: IckbDepositCell[];
  exchangeRatio: ReturnType<typeof Ratio.from>;
}): Promise<void> {
  await expect(
    options.sdk.buildConversionTransaction(ccc.Transaction.default(), {
      direction: ICKB_TO_CKB,
      amount: ICKB_DEPOSIT_CAP,
      lock: options.lock,
      signer: stubSigner,
      context: conversionContext({
        system: {
          exchangeRatio: options.exchangeRatio,
          ckbAvailable: 10n,
          poolDeposits: {
            deposits: options.deposits,
            id: "pool",
          },
        },
        ckbAvailable: 0n,
        ickbAvailable: ICKB_DEPOSIT_CAP,
      }),
    }),
  ).resolves.toMatchObject({
    ok: true,
    conversion: { kind: DIRECT_PLUS_ORDER },
  });
}

export function mockWithdrawalWithRemainderOrder(
  fixture: Pick<SdkFixture, "orderManager" | "ownedOwnerManager">,
  expectedDeposits: unknown,
  expectedAmounts: { ckbValue: bigint; udtValue: bigint },
): WithdrawalRemainderOrderMocks {
  const requestWithdrawal = vi
    .spyOn(fixture.ownedOwnerManager, "requestWithdrawal")
    .mockImplementation((txLike, deposits) => {
      expect(deposits).toEqual(expectedDeposits);
      return passthroughTransaction(txLike);
    });
  const mint = vi
    .spyOn(fixture.orderManager, "mint")
    .mockImplementation((txLike, _lock, _info, amounts) => {
      expect(amounts).toEqual(expectedAmounts);
      return passthroughTransaction(txLike);
    });
  return { mint, requestWithdrawal };
}

class TestIckbUdt extends IckbUdt {
  public readonly completeByMock = vi.fn(
    async (txLike: ccc.TransactionLike): Promise<ccc.Transaction> => {
      return asyncPassthroughTransaction(txLike);
    },
  );

  constructor(udt: ccc.Script) {
    super({
      code: { txHash: hash("a1"), index: 0n },
      script: udt,
      logicCode: { txHash: hash("a2"), index: 0n },
      logicScript: script("a3"),
      daoManager: new DaoManager(script("a4"), []),
    });
  }

  public override isUdt(cell: ccc.Cell): boolean {
    return cell.cellOutput.type?.eq(this.script) ?? false;
  }

  public override async completeBy(
    txLike: ccc.TransactionLike,
  ): Promise<ccc.Transaction> {
    return this.completeByMock(txLike);
  }
}
