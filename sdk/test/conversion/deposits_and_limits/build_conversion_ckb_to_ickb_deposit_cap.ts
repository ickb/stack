import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConversionTransaction } from "../../../src/build.ts";
import { completeTransaction } from "../../../src/complete.ts";
import { DAO } from "../../../src/constants.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { state } from "../../transaction/base/support/sdk_core_support.ts";
import { stubSigner } from "./support/sdk_fixture_support.ts";

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

// Beside the receipt, the order, its master and the change.
const maxDirectDeposits = 60;

const CKB_TO_ICKB = "ckb-to-ickb";

describe("buildConversionTransaction", () => {
  it("throws when the walk ends on the DAO output limit, which its last plans never reach", async () => {
    vi.mocked(completeTransaction).mockResolvedValue({
      ok: false,
      reason: "dao-output-limit",
    });

    await expect(
      buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP * 2n,
        signer: stubSigner,
        state: state({ ckbAvailable: ICKB_DEPOSIT_CAP * 2n }),
      }),
    ).rejects.toThrow(new Error("The last plan exceeds the DAO output limit"));
  });

  it("starts CKB-to-iCKB planning at the most deposits a conversion holds", async () => {
    const result = await buildConversionTransaction({
      direction: CKB_TO_ICKB,
      amount: ICKB_DEPOSIT_CAP * BigInt(maxDirectDeposits + 1),
      signer: stubSigner,
      state: state({
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
