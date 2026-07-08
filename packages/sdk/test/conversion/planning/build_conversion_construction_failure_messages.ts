import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP } from "@ickb/core";
import { DaoOutputLimitError } from "@ickb/dao";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversionTransactionOptions } from "../../../src/sdk.ts";
import {
  baseClient,
  conversionContext,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const CKB_TO_ICKB = "ckb-to-ickb";

const RPC_FAILED = "RPC failed";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("preserves retryable construction errors when retries exhaust into planning misses", async () => {
    const { sdk, logicManager, lock } = testSdk();
    vi.spyOn(logicManager, "deposit").mockRejectedValue(new DaoOutputLimitError(65));

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: conversionContext({
          system: {
            ckbAvailable: ICKB_DEPOSIT_CAP,
            feeRate: ccc.fixedPointFrom(1),
          },
          ckbAvailable: ICKB_DEPOSIT_CAP,
          ickbAvailable: 0n,
        }),
      }),
    ).rejects.toBeInstanceOf(DaoOutputLimitError);
  });

  it("uses plain-object error messages in conversion construction failures", async () => {
    const { sdk, logicManager, lock } = testSdk();
    vi.spyOn(logicManager, "deposit").mockRejectedValue({
      message: RPC_FAILED,
    });

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP,
        lock,
        context: conversionContext({
          system: { ckbAvailable: ICKB_DEPOSIT_CAP },
          ckbAvailable: ICKB_DEPOSIT_CAP,
          ickbAvailable: 0n,
        }),
      }),
    ).rejects.toThrow(RPC_FAILED);
  });

  it("uses string and bigint object error messages in conversion construction failures", async () => {
    const { sdk, logicManager, lock } = testSdk();
    vi.spyOn(logicManager, "deposit")
      .mockRejectedValueOnce(RPC_FAILED)
      .mockRejectedValueOnce({ code: 1n });

    const options: ConversionTransactionOptions = {
      direction: CKB_TO_ICKB,
      amount: ICKB_DEPOSIT_CAP,
      lock,
      context: conversionContext({
        system: { ckbAvailable: ICKB_DEPOSIT_CAP },
        ckbAvailable: ICKB_DEPOSIT_CAP,
        ickbAvailable: 0n,
      }),
    };

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, options),
    ).rejects.toThrow(RPC_FAILED);
    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), baseClient, options),
    ).rejects.toThrow('{"code":"1"}');
  });
});
