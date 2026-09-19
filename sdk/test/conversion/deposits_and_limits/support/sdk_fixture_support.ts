import { ccc } from "@ckb-ccc/core";
import {
  asyncPassthroughTransaction,
  FakeCkbSigner,
  headerLike,
  passthroughTransaction,
  script,
  StubClient,
  transactionWithHeader,
} from "@ickb/testkit";
import { expect, vi, type MockInstance } from "vitest";

import { LogicManager, type IckbDepositCell } from "../../../../src/logic.ts";
import { OrderManager } from "../../../../src/order/order.ts";
import type { Ratio } from "../../../../src/order/ratio.ts";
import { OwnedOwnerManager } from "../../../../src/owned_owner.ts";
import { IckbSdk } from "../../../../src/sdk.ts";
import { ICKB_DEPOSIT_CAP, IckbUdt } from "../../../../src/udt.ts";
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
const GENESIS_AR = 10000000000000000n;
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
  const daoManager = { script: dao, cellDeps: options.daoDeps ?? [] };
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
        ickbUdt: fakeIckbUdt(udt, logic, daoManager),
        ownedOwner: ownedOwnerManager,
        ickbLogic: logicManager,
        order: orderManager,
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
  const logicManager = new LogicManager(script("22"), [], {
    script: script("33"),
    cellDeps: [],
  });
  const ownedOwnerManager = new OwnedOwnerManager(script("44"), [], {
    script: script("33"),
    cellDeps: [],
  });
  const orderManager = new OrderManager(script("55"), [], script("66"));
  const ickbUdt = fakeIckbUdt();
  const sdk = new IckbSdk({
    ickbUdt,
    ownedOwner: ownedOwnerManager,
    ickbLogic: logicManager,
    order: orderManager,
  });
  withCompletion(sdk, options.completion);
  return { sdk, ickbUdt, logicManager, ownedOwnerManager, orderManager, lock };
}

/** Signer for planning tests; completion is a passthrough, so it never scans. */
export const stubSigner: ccc.Signer = new ccc.SignerCkbScriptReadonly(
  baseClient,
  script("11"),
);

/** Signer over a client that serves headers only; completion funds from the cells it is given. */
export function fundedSigner(
  cells: readonly ccc.Cell[],
  locks: readonly ccc.Script[],
): { client: StubClient; signer: ccc.Signer; cells: ccc.Cell[] } {
  const client = new StubClient({
    findCellsPagedNoCache: async (): ReturnType<ccc.Client["findCellsPagedNoCache"]> => {
      await Promise.resolve();
      throw new Error("Completion must not scan");
    },
    // Fixture deposits are worth their free capacity one to one, so the header they
    // are valued at carries the genesis accumulated rate.
    getTransactionWithHeader: async (): ReturnType<
      ccc.Client["getTransactionWithHeader"]
    > => {
      await Promise.resolve();
      return transactionWithHeader(
        headerLike({
          dao: { c: 0n, ar: GENESIS_AR, s: 0n, u: 0n },
          epoch: [1n, 0n, 1n],
          number: 1n,
        }),
      );
    },
  });
  return { client, signer: new FakeCkbSigner(client, [...locks]), cells: [...cells] };
}

export interface SdkFixture {
  sdk: IckbSdk;
  ickbUdt: ReturnType<typeof fakeIckbUdt>;
  logicManager: LogicManager;
  ownedOwnerManager: OwnedOwnerManager;
  orderManager: OrderManager;
  lock: ccc.Script;
}

/** Fake iCKB token that recognises the fixture's logic deposits so completion values them. */
export function fakeIckbUdt(
  udt = script("66"),
  logic = script("22"),
  dao?: { script: ccc.Script },
): IckbUdt {
  return new TestIckbUdt(udt, logic, dao?.script ?? script("33"));
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
          poolDeposits: options.deposits,
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
  constructor(udt: ccc.Script, logic: ccc.Script, daoScript: ccc.Script) {
    super({
      code: { txHash: hash("a1"), index: 0n },
      script: udt,
      logicCode: { txHash: hash("a2"), index: 0n },
      logicScript: logic,
      daoScript,
    });
  }

  public override isUdt(cell: ccc.Cell): boolean {
    return cell.cellOutput.type?.eq(this.script) ?? false;
  }
}
