import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP } from "@ickb/core";
import { DaoOutputLimitError } from "@ickb/dao";
import { passthroughTransaction } from "@ickb/testkit";
import { CheckedUint128LE } from "@ickb/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  conversionContext,
  transactionWithOutputs,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  placeholderWithdrawal,
  receiptValue,
} from "../withdrawal_quotes/support/sdk_cell_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  expectCkbToIckbDirectRetryBuild,
  mockPassthroughMint,
  mockUnitDeposit,
  testSdk,
} from "./support/sdk_fixture_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const CKB_TO_ICKB = "ckb-to-ickb";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("accepts 61 base outputs plus an exact direct deposit and fee change", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const deposit = mockUnitDeposit(logicManager);
    const mint = vi
      .spyOn(orderManager, "mint")
      .mockImplementation(passthroughTransaction);

    await expect(
      sdk.buildConversionTransaction(transactionWithOutputs(61, lock), {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: conversionContext({
          system: { ckbAvailable: ICKB_DEPOSIT_CAP },
          ckbAvailable: ICKB_DEPOSIT_CAP,
        }),
      }),
    ).resolves.toMatchObject({
      ok: true,
      conversion: { kind: "direct" },
    });

    expect(deposit).toHaveBeenCalledTimes(1);
    expect(mint).not.toHaveBeenCalled();
  });

  it("rejects 62 base outputs when ready withdrawal keeps every fallback under the DAO limit", async () => {
    const { sdk, logicManager, ownedOwnerManager, orderManager, lock } = testSdk();
    const deposit = vi.spyOn(logicManager, "deposit");
    const withdraw = vi.spyOn(ownedOwnerManager, "withdraw");
    const mint = vi.spyOn(orderManager, "mint");

    await expect(
      sdk.buildConversionTransaction(transactionWithOutputs(62, lock), {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: conversionContext({
          system: { ckbAvailable: ICKB_DEPOSIT_CAP },
          readyWithdrawals: [placeholderWithdrawal],
          ckbAvailable: ICKB_DEPOSIT_CAP,
        }),
      }),
    ).rejects.toThrow(DaoOutputLimitError);

    expect(deposit).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
  });
});

describe(`${BUILD_CONVERSION_TRANSACTION_SUITE} completion shape`, () => {
  it("reserves one completion output for order-only collection without iCKB value", async () => {
    const { sdk, ownedOwnerManager, orderManager, lock } = testSdk();
    vi.spyOn(ownedOwnerManager, "withdraw").mockImplementation(passthroughTransaction);
    const mint = vi
      .spyOn(orderManager, "mint")
      .mockImplementation(passthroughTransaction);

    await expect(
      sdk.buildConversionTransaction(transactionWithOutputs(61, lock), {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        limits: { maxDirectDeposits: 0 },
        context: conversionContext({
          system: { ckbAvailable: ICKB_DEPOSIT_CAP },
          readyWithdrawals: [placeholderWithdrawal],
          ckbAvailable: ICKB_DEPOSIT_CAP,
        }),
      }),
    ).resolves.toMatchObject({
      ok: true,
      conversion: { kind: "order" },
    });

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("reserves one completion output for a direct-plus-order plan", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const remainder = ccc.fixedPointFrom(10000);
    const deposit = mockUnitDeposit(logicManager);
    const mint = vi
      .spyOn(orderManager, "mint")
      .mockImplementation(passthroughTransaction);

    await expect(
      sdk.buildConversionTransaction(transactionWithOutputs(59, lock), {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP + remainder,
        lock,
        context: conversionContext({
          system: { ckbAvailable: ICKB_DEPOSIT_CAP + remainder },
          ckbAvailable: ICKB_DEPOSIT_CAP + remainder,
        }),
      }),
    ).resolves.toMatchObject({
      ok: true,
      conversion: { kind: "direct-plus-order" },
    });

    expect(deposit).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
  });
});

describe(`${BUILD_CONVERSION_TRANSACTION_SUITE} iCKB change reserve`, () => {
  it("still reserves iCKB change for collected receipt value", async () => {
    const { sdk, logicManager, ownedOwnerManager, orderManager, lock } = testSdk();
    const deposit = vi.spyOn(logicManager, "deposit");
    const withdraw = vi.spyOn(ownedOwnerManager, "withdraw");
    const mint = vi.spyOn(orderManager, "mint");

    await expect(
      sdk.buildConversionTransaction(transactionWithOutputs(61, lock), {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: conversionContext({
          system: { ckbAvailable: ICKB_DEPOSIT_CAP },
          receipts: [receiptValue(0n, 1n)],
          readyWithdrawals: [placeholderWithdrawal],
          ckbAvailable: ICKB_DEPOSIT_CAP,
          ickbAvailable: 1n,
        }),
      }),
    ).rejects.toThrow(DaoOutputLimitError);

    expect(deposit).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
  });

  it("reserves iCKB change when an existing iCKB output can be overfunded", async () => {
    const { sdk, ickbUdt, lock } = testSdk();
    const tx = transactionWithOutputs(60, lock);
    tx.addOutput({ lock, type: ickbUdt.script }, CheckedUint128LE.encode(1n));

    await expect(
      sdk.buildConversionTransaction(tx, {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: conversionContext({
          system: { ckbAvailable: ICKB_DEPOSIT_CAP },
          readyWithdrawals: [placeholderWithdrawal],
          ckbAvailable: ICKB_DEPOSIT_CAP,
          ickbAvailable: 2n,
        }),
      }),
    ).rejects.toThrow(DaoOutputLimitError);
  });

  it("keeps the conservative iCKB reserve for unresolved base inputs", async () => {
    const { sdk, lock } = testSdk();
    const tx = transactionWithOutputs(61, lock);
    tx.addInput({ previousOutput: { txHash: `0x${"77".repeat(32)}`, index: 0n } });

    await expect(
      sdk.buildConversionTransaction(tx, {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: conversionContext({
          system: { ckbAvailable: ICKB_DEPOSIT_CAP },
          readyWithdrawals: [placeholderWithdrawal],
          ckbAvailable: ICKB_DEPOSIT_CAP,
        }),
      }),
    ).rejects.toThrow(DaoOutputLimitError);
  });
});

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("retries CKB-to-iCKB direct deposits after DAO output-limit failures", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const deposit = mockUnitDeposit(logicManager).mockImplementationOnce(() => {
      throw new DaoOutputLimitError(65);
    });
    mockPassthroughMint(orderManager);

    await expectCkbToIckbDirectRetryBuild(sdk, lock);

    expect(deposit).toHaveBeenCalledTimes(2);
  });

  it("skips predictably oversized CKB-to-iCKB candidates before building", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const quantities: number[] = [];
    const deposit = vi
      .spyOn(logicManager, "deposit")
      .mockImplementation((txLike, quantity) => {
        quantities.push(quantity);
        return passthroughTransaction(txLike);
      });
    vi.spyOn(orderManager, "mint").mockImplementation(passthroughTransaction);

    await expect(
      sdk.buildConversionTransaction(transactionWithOutputs(60, lock), {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP * 2n + 1n,
        lock,
        context: conversionContext({
          system: { ckbAvailable: ICKB_DEPOSIT_CAP * 3n },
          ckbAvailable: ICKB_DEPOSIT_CAP * 2n + 1n,
          ickbAvailable: 0n,
        }),
      }),
    ).resolves.toMatchObject({
      ok: true,
      conversion: { kind: "order" },
    });

    expect(deposit).not.toHaveBeenCalled();
    expect(quantities).toEqual([]);
  });
});
