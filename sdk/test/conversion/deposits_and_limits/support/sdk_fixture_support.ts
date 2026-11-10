import { ccc } from "@ckb-ccc/core";
import { headerLike, script, StubClient, transactionWithHeader } from "@ickb/testkit";
import { expect, vi } from "vitest";

import { DAO, ICKB_LOGIC, ICKB_UDT, ORDER } from "../../../../src/constants.ts";
import type { ConversionTransactionResult } from "../../../../src/conversion/types.ts";
import type { IckbDepositCell } from "../../../../src/logic.ts";
import { OrderCell } from "../../../../src/order/cells.ts";
import type { Info } from "../../../../src/order/info.ts";
import type { Ratio } from "../../../../src/order/ratio.ts";
import type { WithdrawalGroup } from "../../../../src/owned_owner.ts";
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
  } = {},
): BaseTransactionFixture {
  return {
    botLock: script("11"),
    dao: DAO,
    logic: ICKB_LOGIC,
    sdk: withCompletion(new IckbSdk({ ickbUdt: fakeIckbUdt() }), options.completion),
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
  sdk: IckbSdk;
}

/**
 * SDK over the fake iCKB token. Completion is a passthrough unless `completion: "real"`, so
 * planning tests see the built transaction and walk tests see the real completer.
 */
export function testSdk(
  options: { completion?: "passthrough" | "real" } = {},
): SdkFixture {
  const lock = script("11");
  const ickbUdt = fakeIckbUdt();
  const sdk = new IckbSdk({ ickbUdt });
  withCompletion(sdk, options.completion);
  return { sdk, ickbUdt, lock };
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
  withdrawals: readonly WithdrawalGroup[] = [],
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
    // CCC values each spent DAO withdrawal request at its two headers, so the node serves
    // the request with its own header and its deposit header by number.
    getCellWithHeader: async (outPoint): ReturnType<ccc.Client["getCellWithHeader"]> => {
      await Promise.resolve();
      const owned = withdrawals.find(({ owned: { cell } }) =>
        cell.outPoint.eq(outPoint),
      )?.owned;
      return owned === undefined
        ? undefined
        : { cell: owned.cell, header: owned.headers[1] };
    },
    getHeaderByNumber: async (number): ReturnType<ccc.Client["getHeaderByNumber"]> => {
      await Promise.resolve();
      return withdrawals.find(
        ({ owned: { headers } }) => headers[0].number === ccc.numFrom(number),
      )?.owned.headers[0];
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
  lock: ccc.Script;
}

/**
 * The iCKB token over the real iCKB Logic deposits and receipts, so completion values them;
 * its type is the real iCKB xUDT, so completion also balances the orders the mint creates.
 */
export function fakeIckbUdt(): IckbUdt {
  return new TestIckbUdt();
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
  withdrawn: IckbDepositCell[];
  exchangeRatio: ReturnType<typeof Ratio.from>;
  order: object;
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
  expectDirectPlusOrder(result, options.withdrawn, options.order);
}

/** A direct-plus-order conversion: it requests `withdrawn` and mints the one `order`. */
export function expectDirectPlusOrder(
  result: ConversionTransactionResult,
  withdrawn: IckbDepositCell[],
  order: object,
): void {
  expect(result).toMatchObject({ ok: true, conversionKind: DIRECT_PLUS_ORDER });
  if (!result.ok) {
    throw new Error("Expected a conversion");
  }
  expect(spentOutPoints(result.tx)).toEqual(outPointsOf(withdrawn));
  expect(mintedOrders(result.tx)).toMatchObject([order]);
}

/** The out points the transaction spends, in input order. */
export function spentOutPoints(tx: ccc.Transaction): ccc.Hex[] {
  return tx.inputs.map(({ previousOutput }) => previousOutput.toHex());
}

/** The deposits' out points, in the order given. */
export function outPointsOf(deposits: IckbDepositCell[]): ccc.Hex[] {
  return deposits.map(({ cell }) => cell.outPoint.toHex());
}

class TestIckbUdt extends IckbUdt {
  constructor() {
    super({
      script: ICKB_UDT,
      cellDeps: [{ outPoint: { txHash: hash("a1"), index: 0n }, depType: "depGroup" }],
      logicScript: ICKB_LOGIC,
      daoScript: DAO,
    });
  }

  public override isUdt(cell: ccc.Cell): boolean {
    return cell.cellOutput.type?.eq(this.script) ?? false;
  }
}
