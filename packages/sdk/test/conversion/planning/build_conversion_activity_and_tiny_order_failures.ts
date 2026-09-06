import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ICKB_DEPOSIT_CAP } from "../../../src/core/index.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  mockPassthroughMint,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import {
  placeholderWithdrawal,
  projectionReadyDeposit,
} from "../withdrawal_quotes/support/sdk_cell_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const CKB_TO_ICKB = "ckb-to-ickb";
const ICKB_TO_CKB = "ickb-to-ckb";

const AMOUNT_TOO_SMALL = "amount-too-small";
const FULL_WORKSPACE_TIMEOUT_MS = 20_000;
const INVALID_COUNT_LIMITS = [
  -1,
  0.5,
  NaN,
  Infinity,
  -Infinity,
  Number.MAX_SAFE_INTEGER + 1,
];

describe(`${BUILD_CONVERSION_TRANSACTION_SUITE} count limit intake`, () => {
  it.each(INVALID_COUNT_LIMITS)(
    "rejects invalid conversion count limit %s before transaction construction",
    async (limit) => {
      const { sdk, lock } = testSdk();
      const tx = ccc.Transaction.default();
      const transactionFrom = vi.spyOn(ccc.Transaction, "from");

      for (const limitName of ["maxDirectDeposits", "maxWithdrawalRequests"] as const) {
        await expect(
          sdk.buildConversionTransaction(tx, {
            direction: CKB_TO_ICKB,
            amount: 0n,
            lock,
            context: conversionContext(),
            limits: { [limitName]: limit },
          }),
        ).rejects.toBeInstanceOf(RangeError);
      }

      expect(transactionFrom).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["maxDirectDeposits", 61],
    ["maxWithdrawalRequests", 31],
  ] as const)("rejects %s above its practical maximum", async (limitName, limit) => {
    const { sdk, lock } = testSdk();

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), {
        direction: CKB_TO_ICKB,
        amount: 0n,
        lock,
        context: conversionContext(),
        limits: { [limitName]: limit },
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("returns typed failures for invalid requested amounts", async () => {
    const { sdk, lock } = testSdk();

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), {
        direction: CKB_TO_ICKB,
        amount: -1n,
        lock,
        context: conversionContext(),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "amount-negative" });
    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), {
        direction: CKB_TO_ICKB,
        amount: 2n,
        lock,
        context: conversionContext({ ckbAvailable: 1n }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "insufficient-ckb" });
    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), {
        direction: ICKB_TO_CKB,
        amount: 2n,
        lock,
        context: conversionContext({ ickbAvailable: 1n }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "insufficient-ickb" });
  });

  it("returns typed failures for no activity and tiny orders", async () => {
    const { sdk, lock } = testSdk();

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), {
        direction: CKB_TO_ICKB,
        amount: 0n,
        lock,
        context: conversionContext(),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "nothing-to-do",
      estimatedMaturity: 0n,
    });

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), {
        direction: CKB_TO_ICKB,
        amount: 1n,
        lock,
        context: conversionContext({
          ckbAvailable: 1n,
          ickbAvailable: 0n,
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: AMOUNT_TOO_SMALL,
      estimatedMaturity: 0n,
    });
  });

  it("returns collect-only success when the base transaction already has activity", async () => {
    const { sdk, lock } = testSdk();
    const tx = ccc.Transaction.default();
    tx.addOutput({ lock }, "0x");

    await expect(
      sdk.buildConversionTransaction(tx, {
        direction: CKB_TO_ICKB,
        amount: 0n,
        lock,
        context: conversionContext(),
      }),
    ).resolves.toMatchObject({ ok: true, conversion: { kind: "collect-only" } });
  });
});

describe(`${BUILD_CONVERSION_TRANSACTION_SUITE} order-only paths`, () => {
  it("builds an order-only CKB-to-iCKB conversion", async () => {
    const { sdk, lock, logicManager, orderManager } = testSdk();
    mockPassthroughMint(orderManager);
    const deposit = vi.spyOn(logicManager, "deposit");

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: conversionContext({
          system: { ckbAvailable: ICKB_DEPOSIT_CAP },
          ckbAvailable: ICKB_DEPOSIT_CAP,
        }),
        limits: { maxDirectDeposits: 0 },
      }),
    ).resolves.toMatchObject({ ok: true, conversion: { kind: "order" } });
    expect(deposit).not.toHaveBeenCalled();
  });

  it("builds an order-only iCKB-to-CKB conversion when withdrawals are disabled", async () => {
    const { sdk, lock, orderManager, ownedOwnerManager } = testSdk();
    const deposit = projectionReadyDeposit(ICKB_DEPOSIT_CAP);
    mockPassthroughMint(orderManager);
    const requestWithdrawal = vi.spyOn(ownedOwnerManager, "requestWithdrawal");

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), {
        direction: ICKB_TO_CKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: conversionContext({
          system: {
            poolDeposits: {
              deposits: [deposit],
              id: "pool",
            },
          },
          ickbAvailable: ICKB_DEPOSIT_CAP,
        }),
        limits: { maxWithdrawalRequests: 0 },
      }),
    ).resolves.toMatchObject({ ok: true, conversion: { kind: "order" } });
    expect(requestWithdrawal).not.toHaveBeenCalled();
  });

  it(
    "builds an order-only iCKB-to-CKB conversion while collecting ready withdrawals",
    async () => {
      const { sdk, lock, orderManager, ownedOwnerManager } = testSdk();
      mockPassthroughMint(orderManager);
      vi.spyOn(ownedOwnerManager, "withdraw").mockImplementation((txLike) =>
        ccc.Transaction.from(txLike),
      );

      await expect(
        sdk.buildConversionTransaction(ccc.Transaction.default(), {
          direction: ICKB_TO_CKB,
          amount: ccc.fixedPointFrom(1),
          lock,
          context: conversionContext({
            readyWithdrawals: [placeholderWithdrawal],
            ickbAvailable: ccc.fixedPointFrom(1),
          }),
        }),
      ).resolves.toMatchObject({ ok: true, conversion: { kind: "order" } });
    },
    FULL_WORKSPACE_TIMEOUT_MS,
  );
});
