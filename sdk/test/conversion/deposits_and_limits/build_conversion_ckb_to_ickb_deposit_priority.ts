import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConversionTransaction } from "../../../src/build.ts";
import { ICKB_LOGIC, ORDER } from "../../../src/constants.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { state } from "../../transaction/base/support/sdk_core_support.ts";
import { mintedOrders, stubSigner } from "./support/sdk_fixture_support.ts";

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

describe("buildConversionTransaction", () => {
  it("plans CKB-to-iCKB direct deposits before fallback orders", async () => {
    const lock = script("11");
    const remainder = ccc.fixedPointFrom(10000);

    const result = await buildConversionTransaction(
      stubSigner,
      state({
        ckbAvailable: ICKB_DEPOSIT_CAP * 2n + remainder,
        ickbAvailable: 0n,
      }),
      CKB_TO_ICKB,
      ICKB_DEPOSIT_CAP * 2n + remainder,
    );

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

  it("converts an exact multiple of the deposit with one deposit fewer and an order", async () => {
    const { depositCapacity } = state();
    const result = await buildConversionTransaction(
      stubSigner,
      state({ ckbAvailable: depositCapacity * 2n }),
      CKB_TO_ICKB,
      depositCapacity * 2n,
    );

    expect(result).toMatchObject({ ok: true, conversionKind: "direct-plus-order" });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.orderOccupiedCapacity).toBeGreaterThan(0n);
    expect(
      result.tx.outputs
        .filter(({ lock }) => lock.eq(ICKB_LOGIC))
        .map(({ capacity }) => capacity),
    ).toEqual([depositCapacity]);
    expect(mintedOrders(result.tx)).toMatchObject([
      { ckbValue: depositCapacity, udtValue: 0n },
    ]);
  });

  it.each([
    [state().depositCapacity, "order"],
    [ccc.fixedPointFrom(10000), "order"],
  ])("names a CKB-to-iCKB conversion of %d shannons %s", async (amount, kind) => {
    await expect(
      buildConversionTransaction(
        stubSigner,
        state({ ckbAvailable: amount }),
        CKB_TO_ICKB,
        amount,
      ),
    ).resolves.toMatchObject({ ok: true, conversionKind: kind });
  });
});
