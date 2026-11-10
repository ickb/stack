import { afterEach, describe, expect, it, vi } from "vitest";
import { deposit } from "../../../src/logic.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import { stubSigner, testSdk } from "./support/sdk_fixture_support.ts";

// Calls through to the real builder unless a test injects a failure.
vi.mock(import("../../../src/logic.ts"), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, deposit: vi.fn(original.deposit) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const RPC_FAILED = "RPC failed";

describe("IckbSdk.buildConversionTransaction", () => {
  it("fails fast on non-retryable CKB-to-iCKB construction errors", async () => {
    const { sdk } = testSdk();
    vi.mocked(deposit).mockImplementationOnce(() => {
      throw new Error(RPC_FAILED);
    });

    await expect(
      sdk.buildConversionTransaction({
        direction: "ckb-to-ickb",
        amount: ICKB_DEPOSIT_CAP * 2n,
        signer: stubSigner,
        context: conversionContext({
          ckbAvailable: ICKB_DEPOSIT_CAP * 2n,
          ickbAvailable: 0n,
        }),
      }),
    ).rejects.toThrow(RPC_FAILED);

    expect(deposit).toHaveBeenCalledTimes(1);
  });
});
