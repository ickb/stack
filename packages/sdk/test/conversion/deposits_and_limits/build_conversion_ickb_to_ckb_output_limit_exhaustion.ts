import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP } from "@ickb/core";
import { DaoOutputLimitError } from "@ickb/dao";
import { Ratio } from "@ickb/order";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseClient,
  system,
  transactionWithOutputs,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  placeholderWithdrawal,
  projectionReadyDeposit,
} from "../withdrawal_quotes/support/sdk_cell_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  testSdk,
} from "./support/sdk_fixture_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const ICKB_TO_CKB = "ickb-to-ckb";

const DIRECT_PLUS_ORDER = "direct-plus-order";

const CKB_TO_ICKB = "ckb-to-ickb";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("skips predictably oversized iCKB-to-CKB candidates before building", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    const first = projectionReadyDeposit(ICKB_DEPOSIT_CAP / 2n, 0n);
    const second = projectionReadyDeposit(ICKB_DEPOSIT_CAP / 2n, 15n * 60n * 1000n);
    const requestedCounts: number[] = [];
    const requestWithdrawal = vi
      .spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(async (txLike, deposits) => {
        await Promise.resolve();
        requestedCounts.push(deposits.length);
        return ccc.Transaction.from(txLike);
      });
    vi.spyOn(orderManager, "mint").mockImplementation((txLike) =>
      ccc.Transaction.from(txLike),
    );

    await expect(
      sdk.buildConversionTransaction(transactionWithOutputs(60, lock), baseClient, {
        direction: ICKB_TO_CKB,
        amount: ICKB_DEPOSIT_CAP + 1n,
        lock,
        context: {
          system: system({
            poolDeposits: {
              deposits: [first, second],
              readyDeposits: [first, second],
              id: "pool",
            },
          }),
          receipts: [],
          readyWithdrawals: [],
          availableOrders: [],
          ckbAvailable: 0n,
          ickbAvailable: ICKB_DEPOSIT_CAP + 1n,
          estimatedMaturity: 0n,
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      conversion: { kind: DIRECT_PLUS_ORDER },
    });

    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
    expect(requestedCounts).toEqual([1]);
  });
});

describe(`${BUILD_CONVERSION_TRANSACTION_SUITE} output-limit exhaustion`, () => {
  it("reports predictable DAO output-limit exhaustion", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const deposit = vi
      .spyOn(logicManager, "deposit")
      .mockImplementation(async (txLike) => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });
    const mint = vi
      .spyOn(orderManager, "mint")
      .mockImplementation((txLike) => ccc.Transaction.from(txLike));

    await expect(
      sdk.buildConversionTransaction(transactionWithOutputs(64, lock), baseClient, {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: {
          system: system({ ckbAvailable: ICKB_DEPOSIT_CAP }),
          receipts: [],
          readyWithdrawals: [placeholderWithdrawal],
          availableOrders: [],
          ckbAvailable: ICKB_DEPOSIT_CAP,
          ickbAvailable: 0n,
          estimatedMaturity: 0n,
        },
      }),
    ).rejects.toThrow(DaoOutputLimitError);

    expect(deposit).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
  });

  it("reports predictable iCKB-to-CKB DAO output-limit exhaustion", async () => {
    const { sdk, ownedOwnerManager, lock } = testSdk();
    const anchorDeposit = projectionReadyDeposit(ICKB_DEPOSIT_CAP + 1n, 0n, {
      id: "ab",
    });
    const readyDeposit = projectionReadyDeposit(ICKB_DEPOSIT_CAP, 1n, {
      ckbValue: ICKB_DEPOSIT_CAP * ((1n << 64n) - 1n),
    });
    const requestWithdrawal = vi
      .spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(async (txLike) => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });

    await expect(
      sdk.buildConversionTransaction(transactionWithOutputs(64, lock), baseClient, {
        direction: ICKB_TO_CKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: {
          system: system({
            exchangeRatio: Ratio.from({
              ckbScale: (1n << 64n) - 1n,
              udtScale: 1n,
            }),
            poolDeposits: {
              deposits: [anchorDeposit, readyDeposit],
              readyDeposits: [anchorDeposit, readyDeposit],
              id: "pool",
            },
          }),
          receipts: [],
          readyWithdrawals: [],
          availableOrders: [],
          ckbAvailable: 0n,
          ickbAvailable: ICKB_DEPOSIT_CAP,
          estimatedMaturity: 0n,
        },
      }),
    ).rejects.toThrow(DaoOutputLimitError);

    expect(requestWithdrawal).not.toHaveBeenCalled();
  });
});
