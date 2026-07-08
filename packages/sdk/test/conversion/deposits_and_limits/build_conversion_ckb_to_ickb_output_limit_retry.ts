import { ICKB_DEPOSIT_CAP } from "@ickb/core";
import { DaoOutputLimitError } from "@ickb/dao";
import { passthroughTransaction } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseClient,
  conversionContext,
  transactionWithOutputs,
} from "../../transaction/base/support/sdk_core_support.ts";
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
  it("retries CKB-to-iCKB direct deposits after DAO output-limit failures", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const deposit = mockUnitDeposit(logicManager).mockRejectedValueOnce(
      new DaoOutputLimitError(65),
    );
    mockPassthroughMint(orderManager);

    await expectCkbToIckbDirectRetryBuild(sdk, lock);

    expect(deposit).toHaveBeenCalledTimes(2);
  });

  it("skips predictably oversized CKB-to-iCKB candidates before building", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const quantities: number[] = [];
    const deposit = vi
      .spyOn(logicManager, "deposit")
      .mockImplementation(async (txLike, quantity) => {
        await Promise.resolve();
        quantities.push(quantity);
        return passthroughTransaction(txLike);
      });
    vi.spyOn(orderManager, "mint").mockImplementation(passthroughTransaction);

    await expect(
      sdk.buildConversionTransaction(transactionWithOutputs(60, lock), baseClient, {
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
      conversion: { kind: "direct-plus-order" },
    });

    expect(deposit).toHaveBeenCalledTimes(1);
    expect(quantities).toEqual([1]);
  });
});
