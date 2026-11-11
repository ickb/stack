import { ccc } from "@ckb-ccc/core";
import {
  genesisHeader,
  headerLike,
  script,
  StubClient,
  transactionWithHeader,
} from "@ickb/testkit";
import { expect } from "vitest";

import { buildConversionTransaction } from "../../../../src/build.ts";
import type {
  CompletedTransaction,
  CompleteTransactionResult,
} from "../../../../src/complete.ts";
import { DAO, ICKB_LOGIC, ORDER } from "../../../../src/constants.ts";
import type { ConversionTransactionResult } from "../../../../src/conversion/types.ts";
import type { DepositCell } from "../../../../src/logic.ts";
import { OrderCell } from "../../../../src/order/cells.ts";
import type { Info } from "../../../../src/order/info.ts";
import type { Ratio } from "../../../../src/order/ratio.ts";
import type { WithdrawalGroup } from "../../../../src/owned_owner.ts";
import { ICKB_DEPOSIT_CAP } from "../../../../src/udt.ts";
import {
  baseClient,
  hash,
  state,
} from "../../../transaction/base/support/sdk_core_support.ts";

const ICKB_TO_CKB = "ickb-to-ckb";
const GENESIS_AR = 10000000000000000n;
const DIRECT_PLUS_ORDER = "direct-plus-order";

export function baseTransactionFixture(): BaseTransactionFixture {
  return { botLock: script("11"), dao: DAO, logic: ICKB_LOGIC };
}

export interface BaseTransactionFixture {
  botLock: ccc.Script;
  dao: ccc.Script;
  logic: ccc.Script;
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
        : { cell: owned.cell, header: owned.requestHeader };
    },
    // Header 0 is the real testnet genesis, which completion reads for the chain's dep group.
    getHeaderByNumber: async (number): ReturnType<ccc.Client["getHeaderByNumber"]> => {
      await Promise.resolve();
      if (ccc.numFrom(number) === 0n) {
        return genesisHeader("testnet");
      }
      return withdrawals.find(
        ({ owned: { depositHeader } }) => depositHeader.number === ccc.numFrom(number),
      )?.owned.depositHeader;
    },
  });
  return {
    client,
    signer: new ccc.SignerCkbScriptReadonly(client, [...locks]),
    cells: [...cells],
  };
}

/** The completed transaction of a completion the test expects to succeed. */
export function mustComplete(result: CompleteTransactionResult): CompletedTransaction {
  if (!result.ok) {
    throw new Error(`Expected a completed transaction, got ${result.reason}`);
  }
  return result;
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
  deposits: DepositCell[];
  withdrawn: DepositCell[];
  exchangeRatio: ReturnType<typeof Ratio.from>;
  order: object;
}): Promise<void> {
  const result = await buildConversionTransaction(
    stubSigner,
    state({
      exchangeRatio: options.exchangeRatio,
      poolDeposits: options.deposits,
      ckbAvailable: 0n,
      ickbAvailable: ICKB_DEPOSIT_CAP,
    }),
    ICKB_TO_CKB,
    ICKB_DEPOSIT_CAP,
  );
  expectDirectPlusOrder(result, options.withdrawn, options.order);
}

/** A direct-plus-order conversion: it requests `withdrawn` and mints the one `order`. */
export function expectDirectPlusOrder(
  result: ConversionTransactionResult,
  withdrawn: DepositCell[],
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
export function outPointsOf(deposits: DepositCell[]): ccc.Hex[] {
  return deposits.map(({ cell }) => cell.outPoint.toHex());
}
