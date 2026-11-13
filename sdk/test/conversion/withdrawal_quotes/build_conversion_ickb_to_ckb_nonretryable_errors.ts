import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConversionTransaction } from "../../../src/build.ts";
import { requestWithdrawal } from "../../../src/owned_owner.ts";
import { state } from "../../transaction/base/support/sdk_core_support.ts";
import { stubSigner } from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { projectionReadyDeposit } from "./support/sdk_cell_support.ts";

// Calls through to the real builder unless a test injects a failure.
vi.mock(import("../../../src/owned_owner.ts"), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, requestWithdrawal: vi.fn(original.requestWithdrawal) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const WITHDRAWAL_FAILED = "withdrawal failed";

const ICKB_TO_CKB = "ickb-to-ckb";

describe("buildConversionTransaction", () => {
  it("fails fast on non-retryable iCKB-to-CKB construction errors", async () => {
    const unit = ccc.fixedPointFrom(1000);
    const extra = projectionReadyDeposit(unit, 0n);
    const protectedAnchor = projectionReadyDeposit(2n * unit, 1n);
    vi.mocked(requestWithdrawal).mockImplementationOnce(() => {
      throw new Error(WITHDRAWAL_FAILED);
    });

    await expect(
      buildConversionTransaction(
        stubSigner,
        state({
          poolDeposits: [extra, protectedAnchor],
          ckbAvailable: 0n,
          ickbAvailable: unit + unit / 2n,
        }),
        ICKB_TO_CKB,
        // More than the extra deposit, so its plan carries an order and is built.
        unit + unit / 2n,
      ),
    ).rejects.toThrow(WITHDRAWAL_FAILED);
  });
});
