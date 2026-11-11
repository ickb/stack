import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ICKB_LOGIC, ORDER } from "../../../src/constants.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { state } from "../../transaction/base/support/sdk_core_support.ts";
import { mintedOrders, stubSigner, testSdk } from "./support/sdk_fixture_support.ts";

// The built transaction as is: these tests read what the builders put in.
vi.mock(import("../../../src/complete.ts"), async (importOriginal) =>
  (await import("./support/passthrough_completion.ts")).passthroughCompletion(
    await importOriginal(),
  ),
);

afterEach(() => {
  vi.restoreAllMocks();
});

const CKB_TO_ICKB = "ckb-to-ickb";

const DIRECT_PLUS_ORDER = "direct-plus-order";

describe("IckbSdk.buildConversionTransaction", () => {
  it("plans CKB-to-iCKB direct deposits before fallback orders", async () => {
    const { sdk, lock } = testSdk();
    const remainder = ccc.fixedPointFrom(10000);

    const result = await sdk.buildConversionTransaction({
      direction: CKB_TO_ICKB,
      amount: ICKB_DEPOSIT_CAP * 2n + remainder,
      signer: stubSigner,
      state: state({
        ckbAvailable: ICKB_DEPOSIT_CAP * 2n + remainder,
        ickbAvailable: 0n,
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      conversionKind: DIRECT_PLUS_ORDER,
    });
    if (!result.ok) {
      throw new Error("Expected a conversion");
    }
    // Two cap-sized deposits and their receipt first, then the remainder order and master.
    expect(result.tx.outputs.map(({ lock: outputLock }) => outputLock)).toEqual([
      ICKB_LOGIC,
      ICKB_LOGIC,
      lock,
      ORDER,
      lock,
    ]);
    expect(result.tx.outputs.slice(0, 2).map(({ capacity }) => capacity)).toEqual([
      ICKB_DEPOSIT_CAP,
      ICKB_DEPOSIT_CAP,
    ]);
    expect(result.tx.outputs[2]?.type?.eq(ICKB_LOGIC)).toBe(true);
    expect(mintedOrders(result.tx)).toMatchObject([
      { ckbValue: remainder, udtValue: 0n },
    ]);
  });

  it("reports no order cell space for whole deposits alone", async () => {
    const { sdk } = testSdk();

    const result = await sdk.buildConversionTransaction({
      direction: CKB_TO_ICKB,
      amount: ICKB_DEPOSIT_CAP * 2n,
      signer: stubSigner,
      state: state({ ckbAvailable: ICKB_DEPOSIT_CAP * 2n }),
    });

    expect(result).toMatchObject({ ok: true, conversionKind: "direct" });
    expect(result).not.toHaveProperty("orderOccupiedCapacity");
  });

  it.each([
    [state().depositCapacity, "direct"],
    [ccc.fixedPointFrom(10000), "order"],
  ])("names a CKB-to-iCKB conversion of %d shannons %s", async (amount, kind) => {
    const { sdk } = testSdk();

    await expect(
      sdk.buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount,
        signer: stubSigner,
        state: state({ ckbAvailable: amount }),
      }),
    ).resolves.toMatchObject({ ok: true, conversionKind: kind });
  });
});
