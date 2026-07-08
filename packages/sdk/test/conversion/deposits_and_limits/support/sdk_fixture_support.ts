import { ccc } from "@ckb-ccc/core";
import {
  ICKB_DEPOSIT_CAP,
  IckbUdt,
  LogicManager,
  OwnedOwnerManager,
  type IckbDepositCell,
} from "@ickb/core";
import { DaoManager } from "@ickb/dao";
import { OrderManager, type Ratio } from "@ickb/order";
import {
  asyncPassthroughTransaction,
  passthroughTransaction,
  script,
} from "@ickb/testkit";
import { expect, vi, type MockInstance } from "vitest";
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

const CKB_TO_ICKB = "ckb-to-ickb";
const ICKB_TO_CKB = "ickb-to-ckb";
const DIRECT_PLUS_ORDER = "direct-plus-order";

export function baseTransactionFixture(
  options: {
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
    sdk: new IckbSdk(fakeIckbUdt(udt), ownedOwnerManager, logicManager, orderManager, [
      botLock,
    ]),
    udt,
  };
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

export function testSdk(): SdkFixture {
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
  return {
    sdk: new IckbSdk(ickbUdt, ownedOwnerManager, logicManager, orderManager, []),
    ickbUdt,
    logicManager,
    ownedOwnerManager,
    orderManager,
    lock,
  };
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

export function signerWithSendTransaction(
  sendTransaction: ccc.Signer["sendTransaction"],
): ccc.Signer {
  return new TestSigner(sendTransaction);
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

export function mockUnitDeposit(
  logicManager: LogicManager,
): MockInstance<LogicManager["deposit"]> {
  return vi
    .spyOn(logicManager, "deposit")
    .mockImplementation(async (txLike, quantity) => {
      await Promise.resolve();
      expect(quantity).toBe(1);
      return passthroughTransaction(txLike);
    });
}

export async function expectCkbToIckbDirectRetryBuild(
  sdk: IckbSdk,
  lock: ccc.Script,
): Promise<void> {
  await expect(
    sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
      direction: CKB_TO_ICKB,
      amount: ICKB_DEPOSIT_CAP * 2n,
      lock,
      context: conversionContext({
        system: { ckbAvailable: ICKB_DEPOSIT_CAP * 2n },
        ckbAvailable: ICKB_DEPOSIT_CAP * 2n,
        ickbAvailable: 0n,
      }),
    }),
  ).resolves.toMatchObject({
    ok: true,
    conversion: { kind: DIRECT_PLUS_ORDER },
  });
}

export async function expectIckbToCkbDirectPlusOrder(options: {
  sdk: IckbSdk;
  lock: ccc.Script;
  deposits: IckbDepositCell[];
  exchangeRatio: ReturnType<typeof Ratio.from>;
}): Promise<void> {
  await expect(
    options.sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
      direction: ICKB_TO_CKB,
      amount: ICKB_DEPOSIT_CAP,
      lock: options.lock,
      context: conversionContext({
        system: {
          exchangeRatio: options.exchangeRatio,
          ckbAvailable: 10n,
          poolDeposits: {
            deposits: options.deposits,
            readyDeposits: options.deposits,
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
    .mockImplementation(async (txLike, deposits) => {
      await Promise.resolve();
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
    super(
      { txHash: hash("a1"), index: 0n },
      udt,
      { txHash: hash("a2"), index: 0n },
      script("a3"),
      new DaoManager(script("a4"), []),
    );
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
