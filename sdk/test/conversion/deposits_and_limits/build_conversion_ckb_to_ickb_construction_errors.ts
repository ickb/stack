import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConversionTransaction } from "../../../src/build.ts";
import { deposit } from "../../../src/logic.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { state } from "../../transaction/base/support/sdk_core_support.ts";
import { stubSigner } from "./support/sdk_fixture_support.ts";

// Calls through to the real builder unless a test injects a failure.
vi.mock(import("../../../src/logic.ts"), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, deposit: vi.fn(original.deposit) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const RPC_FAILED = "RPC failed";

describe("buildConversionTransaction", () => {
  it("fails fast on non-retryable CKB-to-iCKB construction errors", async () => {
    vi.mocked(deposit).mockImplementationOnce(() => {
      throw new Error(RPC_FAILED);
    });

    await expect(
      buildConversionTransaction(
        stubSigner,
        state({
          ckbAvailable: ICKB_DEPOSIT_CAP * 2n,
          ickbAvailable: 0n,
        }),
        "ckb-to-ickb",
        ICKB_DEPOSIT_CAP * 2n,
      ),
    ).rejects.toThrow(RPC_FAILED);

    expect(deposit).toHaveBeenCalledTimes(1);
  });
});
