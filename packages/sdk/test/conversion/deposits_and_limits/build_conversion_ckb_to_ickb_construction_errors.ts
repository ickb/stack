import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP } from "@ickb/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseClient,
  conversionContext,
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

const DAO_OUTPUT_LIMIT_ERROR_NAME = "DaoOutputLimitError";

const RPC_FAILED = "RPC failed";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("recognizes DAO output-limit errors across package runtime boundaries", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const outputLimitError = new Error("same domain error from another package copy");
    Object.defineProperty(outputLimitError, "name", {
      value: DAO_OUTPUT_LIMIT_ERROR_NAME,
    });
    const deposit = mockUnitDeposit(logicManager).mockRejectedValueOnce(outputLimitError);
    mockPassthroughMint(orderManager);

    await expectCkbToIckbDirectRetryBuild(sdk, lock);

    expect(deposit).toHaveBeenCalledTimes(2);
  });

  it("fails fast on non-retryable CKB-to-iCKB construction errors", async () => {
    const { sdk, logicManager, lock } = testSdk();
    const deposit = vi
      .spyOn(logicManager, "deposit")
      .mockRejectedValue(new Error(RPC_FAILED));

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
        direction: "ckb-to-ickb",
        amount: ICKB_DEPOSIT_CAP * 2n,
        lock,
        context: conversionContext({
          system: { ckbAvailable: ICKB_DEPOSIT_CAP * 2n },
          ckbAvailable: ICKB_DEPOSIT_CAP * 2n,
          ickbAvailable: 0n,
        }),
      }),
    ).rejects.toThrow(RPC_FAILED);

    expect(deposit).toHaveBeenCalledTimes(1);
  });
});
