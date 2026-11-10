import { afterEach, describe, expect, it, vi } from "vitest";
import { DAO } from "../../../src/constants.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import { stubSigner, testSdk } from "./support/sdk_fixture_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const maxDirectDeposits = 63;

const CKB_TO_ICKB = "ckb-to-ickb";

describe("IckbSdk.buildConversionTransaction", () => {
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
