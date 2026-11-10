import { afterEach, describe, expect, it, vi } from "vitest";
import { completeTransaction } from "../../../src/complete.ts";
import { DAO } from "../../../src/constants.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import { stubSigner, testSdk } from "./support/sdk_fixture_support.ts";

// The built transaction as is: these tests read what the builders put in.
vi.mock(import("../../../src/complete.ts"), async (importOriginal) =>
  (await import("./support/passthrough_completion.ts")).passthroughCompletion(
    await importOriginal(),
  ),
);

afterEach(() => {
  vi.restoreAllMocks();
  // Back to the passthrough the factory gave it.
  vi.mocked(completeTransaction).mockReset();
});

const maxDirectDeposits = 63;

const CKB_TO_ICKB = "ckb-to-ickb";

describe("IckbSdk.buildConversionTransaction", () => {
  it("throws when the walk ends on the DAO output limit, which its last plans never reach", async () => {
    const { sdk } = testSdk();
    vi.mocked(completeTransaction).mockResolvedValue({
      ok: false,
      reason: "dao-output-limit",
    });

    await expect(
      sdk.buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP * 2n,
        signer: stubSigner,
        context: conversionContext({ ckbAvailable: ICKB_DEPOSIT_CAP * 2n }),
      }),
    ).rejects.toThrow(new Error("The last plan exceeds the DAO output limit"));
  });

  it("starts CKB-to-iCKB planning at the DAO output limit", async () => {
    const { sdk } = testSdk();

    const result = await sdk.buildConversionTransaction({
      direction: CKB_TO_ICKB,
      amount: ICKB_DEPOSIT_CAP * BigInt(maxDirectDeposits + 1),
      signer: stubSigner,
      context: conversionContext({
        ckbAvailable: ICKB_DEPOSIT_CAP * BigInt(maxDirectDeposits + 1),
        ickbAvailable: 0n,
      }),
    });

    if (!result.ok) {
      throw new Error("Expected a conversion");
    }
    // The first candidate, the one passthrough completion accepts, deposits the most.
    expect(result.tx.outputs.filter(({ type }) => type?.eq(DAO) === true)).toHaveLength(
      maxDirectDeposits,
    );
  });
});
