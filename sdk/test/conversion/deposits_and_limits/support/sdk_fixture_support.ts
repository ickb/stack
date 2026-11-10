import { ccc } from "@ckb-ccc/core";
import { headerLike, script, StubClient, transactionWithHeader } from "@ickb/testkit";
import { expect, vi, type MockInstance } from "vitest";

import { ICKB_UDT, ORDER } from "../../../../src/constants.ts";
import { LogicManager, type IckbDepositCell } from "../../../../src/logic.ts";
import { OrderCell } from "../../../../src/order/cells.ts";
import type { Info } from "../../../../src/order/info.ts";
import type { Ratio } from "../../../../src/order/ratio.ts";
import { OwnedOwnerManager } from "../../../../src/owned_owner.ts";
import { IckbSdk } from "../../../../src/sdk.ts";
import { ICKB_DEPOSIT_CAP, IckbUdt } from "../../../../src/udt.ts";
import {
  baseClient,
  conversionContext,
  hash,
} from "../../../transaction/base/support/sdk_core_support.ts";

const ICKB_TO_CKB = "ickb-to-ckb";
const GENESIS_AR = 10000000000000000n;
const DIRECT_PLUS_ORDER = "direct-plus-order";

export function baseTransactionFixture(
  options: {
    completion?: "passthrough" | "real";
    daoDeps?: ccc.CellDep[];
    logicDeps?: ccc.CellDep[];
    ownedOwnerDeps?: ccc.CellDep[];
  } = {},
): BaseTransactionFixture {
  const botLock = script("11");
  const logic = script("22");
  const dao = script("33");
  const ownedOwner = script("44");
  const daoManager = { script: dao, cellDeps: options.daoDeps ?? [] };
  const logicManager = new LogicManager(logic, options.logicDeps ?? [], daoManager);
  const ownedOwnerManager = new OwnedOwnerManager(
    ownedOwner,
    options.ownedOwnerDeps ?? [],
    daoManager,
  );
  return {
    botLock,
    dao,
    logic,
    logicManager,
    ownedOwner,
    ownedOwnerManager,
    sdk: withCompletion(
      new IckbSdk({
        ickbUdt: fakeIckbUdt(logic, daoManager),
        ownedOwner: ownedOwnerManager,
        ickbLogic: logicManager,
      }),
      options.completion,
    ),
  };
}

function withCompletion(
  sdk: IckbSdk,
  completion: "passthrough" | "real" = "passthrough",
): IckbSdk {
  if (completion === "passthrough") {
    vi.spyOn(sdk, "completeTransaction").mockImplementation(async (txLike) => {
      await Promise.resolve();
      return { tx: ccc.Transaction.from(txLike), plannedFee: 0n };
    });
  }
  return sdk;
}

export interface BaseTransactionFixture {
  botLock: ccc.Script;
  dao: ccc.Script;
  logic: ccc.Script;
  logicManager: LogicManager;
  ownedOwner: ccc.Script;
  ownedOwnerManager: OwnedOwnerManager;
  sdk: IckbSdk;
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
  const ickbUdt = fakeIckbUdt();
  const sdk = new IckbSdk({
    ickbUdt,
    ownedOwner: ownedOwnerManager,
    ickbLogic: logicManager,
  });
  withCompletion(sdk, options.completion);
  return { sdk, ickbUdt, logicManager, ownedOwnerManager, lock };
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
    cells: (): never => {
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
  return {
    client,
    signer: new ccc.SignerCkbScriptReadonly(client, [...locks]),
    cells: [...cells],
  };
}

export interface SdkFixture {
  sdk: IckbSdk;
  ickbUdt: ReturnType<typeof fakeIckbUdt>;
  logicManager: LogicManager;
  ownedOwnerManager: OwnedOwnerManager;
  lock: ccc.Script;
}

/**
 * The iCKB token over the fixture's logic deposits, so completion values them; its type
 * is the real iCKB xUDT, so completion also balances the orders the real mint creates.
 */
export function fakeIckbUdt(logic = script("22"), dao?: { script: ccc.Script }): IckbUdt {
  return new TestIckbUdt(logic, dao?.script ?? script("33"));
}

/** The CKB and iCKB each order output of the transaction offers, and its info. */
export function mintedOrders(
  tx: ccc.Transaction,
): Array<{ ckbValue: bigint; udtValue: bigint; info: Info }> {
  return [...tx.outputCells]
    .filter((cell) => cell.cellOutput.lock.eq(ORDER))
    .map((cell) => {
      const order = OrderCell.mustFrom(
        ccc.Cell.from({
          cellOutput: cell.cellOutput,
          outputData: cell.outputData,
          outPoint: { txHash: hash("ef"), index: 0n },
        }),
        0n,
      );
      return {
        ckbValue: order.ckbUnoccupied,
        udtValue: order.udtValue,
        info: order.data.info,
      };
    });
}

export async function expectIckbToCkbDirectPlusOrder(options: {
  sdk: IckbSdk;
  deposits: IckbDepositCell[];
  exchangeRatio: ReturnType<typeof Ratio.from>;
  order: { ckbValue: bigint; udtValue: bigint };
}): Promise<void> {
  const result = await options.sdk.buildConversionTransaction({
    direction: ICKB_TO_CKB,
    amount: ICKB_DEPOSIT_CAP,
    signer: stubSigner,
    context: conversionContext({
      system: {
        exchangeRatio: options.exchangeRatio,
        poolDeposits: options.deposits,
      },
      ckbAvailable: 0n,
      ickbAvailable: ICKB_DEPOSIT_CAP,
    }),
  });
  expect(result).toMatchObject({ ok: true, conversionKind: DIRECT_PLUS_ORDER });
  if (!result.ok) {
    throw new Error("Expected a conversion");
  }
  expect(mintedOrders(result.tx)).toMatchObject([options.order]);
}

/** Requests the expected deposits' withdrawal without building it. */
export function mockWithdrawalRequest(
  ownedOwnerManager: OwnedOwnerManager,
  expectedDeposits: unknown,
): MockInstance<OwnedOwnerManager["requestWithdrawal"]> {
  return vi
    .spyOn(ownedOwnerManager, "requestWithdrawal")
    .mockImplementation((txLike, deposits) => {
      expect(deposits).toEqual(expectedDeposits);
      return ccc.Transaction.from(txLike);
    });
}

class TestIckbUdt extends IckbUdt {
  constructor(logic: ccc.Script, daoScript: ccc.Script) {
    super({
      script: ICKB_UDT,
      cellDeps: [{ outPoint: { txHash: hash("a1"), index: 0n }, depType: "depGroup" }],
      logicScript: logic,
      daoScript,
    });
  }

  public override isUdt(cell: ccc.Cell): boolean {
    return cell.cellOutput.type?.eq(this.script) ?? false;
  }
}
