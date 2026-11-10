import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectConversionTransactionContext } from "../../../src/conversion/projection.ts";
import type { AccountState } from "../../../src/conversion/types.ts";
import type { OrderGroup } from "../../../src/order/cells.ts";
import { makeOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";
import { headerLike, system } from "../../transaction/base/support/sdk_core_support.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
  readyWithdrawalGroup,
  receiptCell,
} from "../withdrawal_quotes/support/sdk_cell_support.ts";
import {
  baseTransactionFixture,
  fundedSigner,
  type BaseTransactionFixture,
} from "./support/sdk_fixture_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

// The largest witness a supported wallet signs with: JoyID's, under a thousand bytes.
const JOYID_WITNESS = ccc.hexFrom(new Uint8Array(1000));

interface Held {
  account: Partial<AccountState>;
  orders?: OrderGroup[];
}
type Holding = (fixture: BaseTransactionFixture) => Held;

const holdings: Array<[string, Holding]> = [
  ["plain CKB alone", (): Held => ({ account: {} })],
  [
    "iCKB",
    ({ botLock }): Held => ({
      account: {
        nativeUdtCells: [
          nativeUdtCell(ccc.fixedPointFrom(100), {
            lock: botLock,
            capacity: ccc.fixedPointFrom(146),
            byte: "e1",
          }),
        ],
      },
    }),
  ],
  [
    "a receipt",
    ({ botLock, logic }): Held => ({
      account: { receipts: [receiptCell("e2", botLock, logic, headerLike(10n))] },
    }),
  ],
  [
    "a refused order",
    ({ botLock }): Held => ({
      account: {},
      orders: [
        makeOrderGroup({
          ownerLock: botLock,
          txHashByte: "e3",
          udtValue: 0n,
        }).group,
      ],
    }),
  ],
  [
    "a ready withdrawal",
    ({ botLock }): Held => ({
      account: {
        withdrawalGroups: [
          readyWithdrawalGroup({
            ownerLock: botLock,
            depositHeader: headerLike(10n),
            withdrawalHeader: headerLike(12n),
          }),
        ],
      },
    }),
  ],
];

describe("ckbConvertible", () => {
  it.each(holdings)(
    "funds a CKB-to-iCKB conversion of all of it, holding %s",
    async (_, holding) => {
      const fixture = baseTransactionFixture({ completion: "real" });
      const { botLock } = fixture;
      const { account: held, orders = [] } = holding(fixture);
      const account: AccountState = {
        capacityCells: [plainCapacityCell(ccc.fixedPointFrom(5000), botLock, "e0")],
        nativeUdtCells: [],
        receipts: [],
        withdrawalGroups: [],
        ...held,
      };
      const cells = [...account.capacityCells, ...account.nativeUdtCells];
      const { signer } = fundedSigner(cells, [botLock], account.withdrawalGroups);
      // The largest witness counts in the fee completion prices.
      const prepare = signer.prepareTransaction.bind(signer);
      vi.spyOn(signer, "prepareTransaction").mockImplementation(async (txLike) => {
        const tx = await prepare(txLike);
        tx.witnesses[0] = JOYID_WITNESS;
        return tx;
      });
      // A high fee rate, so the fee bound counts beyond its margin.
      const sampled = system({ feeRate: 1_000_000n });
      const { projection, context } = projectConversionTransactionContext(
        sampled,
        account,
        orders,
        botLock,
      );

      const result = await fixture.sdk.buildConversionTransaction({
        direction: "ckb-to-ickb",
        amount: projection.ckbConvertible,
        signer,
        context,
      });

      expect(projection.ckbConvertible).toBeGreaterThan(0n);
      expect(result).toMatchObject({ ok: true });
    },
  );

  it("is never negative", () => {
    const { botLock } = baseTransactionFixture();
    const { projection } = projectConversionTransactionContext(
      system(),
      {
        capacityCells: [plainCapacityCell(ccc.fixedPointFrom(100), botLock, "e4")],
        nativeUdtCells: [],
        receipts: [],
        withdrawalGroups: [],
      },
      [],
      botLock,
    );

    expect(projection.ckbConvertible).toBe(0n);
  });
});
