import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ICKB_DEPOSIT_CAP } from "../../../src/core/index.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  testSdk,
} from "./support/sdk_fixture_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const RPC_FAILED = "RPC failed";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("fails fast on non-retryable CKB-to-iCKB construction errors", async () => {
    const { sdk, logicManager, lock } = testSdk();
    const deposit = vi.spyOn(logicManager, "deposit").mockImplementation(() => {
      throw new Error(RPC_FAILED);
    });

    await expect(
      sdk.buildConversionTransaction(ccc.Transaction.default(), {
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
