import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseClient,
  conversionContext,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  mockPassthroughMint,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { placeholderWithdrawal } from "../withdrawal_quotes/support/sdk_cell_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const CKB_TO_ICKB = "ckb-to-ickb";
const ICKB_TO_CKB = "ickb-to-ckb";

const AMOUNT_TOO_SMALL = "amount-too-small";
const FULL_WORKSPACE_TIMEOUT_MS = 20_000;

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("returns typed failures for invalid requested amounts", async () => {
    const { sdk, lock } = testSdk();

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
        direction: CKB_TO_ICKB,
        amount: -1n,
        lock,
        context: conversionContext(),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "amount-negative" });
    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
        direction: CKB_TO_ICKB,
        amount: 2n,
        lock,
        context: conversionContext({ ckbAvailable: 1n }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "insufficient-ckb" });
    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
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
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
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
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
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
      sdk.buildConversionTransaction(tx, baseClient, {
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
    const { sdk, lock, orderManager } = testSdk();
    mockPassthroughMint(orderManager);

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
        direction: CKB_TO_ICKB,
        amount: ccc.fixedPointFrom(1),
        lock,
        context: conversionContext({
          system: { ckbAvailable: ccc.fixedPointFrom(1) },
          ckbAvailable: ccc.fixedPointFrom(1),
        }),
        limits: { maxDirectDeposits: 0 },
      }),
    ).resolves.toMatchObject({ ok: true, conversion: { kind: "order" } });
  });

  it(
    "builds an order-only iCKB-to-CKB conversion while collecting ready withdrawals",
    async () => {
      const { sdk, lock, orderManager, ownedOwnerManager } = testSdk();
      mockPassthroughMint(orderManager);
      vi.spyOn(ownedOwnerManager, "withdraw").mockImplementation(async (txLike) => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });

      await expect(
        sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
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

describe(`${BUILD_CONVERSION_TRANSACTION_SUITE} pool refresh`, () => {
  it("uses freshly scanned pool deposits when iCKB-to-CKB context has no pool snapshot", async () => {
    const { sdk, lock } = testSdk();
    const getPoolDeposits = vi.spyOn(sdk, "getPoolDeposits").mockResolvedValue({
      deposits: [],
      readyDeposits: [],
      id: "fresh",
    });

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
        direction: ICKB_TO_CKB,
        amount: 1n,
        lock,
        context: conversionContext({
          ickbAvailable: 1n,
        }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: AMOUNT_TOO_SMALL });
    expect(getPoolDeposits).toHaveBeenCalledTimes(1);
  });
});
