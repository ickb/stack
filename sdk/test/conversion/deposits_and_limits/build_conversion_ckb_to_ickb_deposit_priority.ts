import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ORDER } from "../../../src/constants.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import { mintedOrders, stubSigner, testSdk } from "./support/sdk_fixture_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const CKB_TO_ICKB = "ckb-to-ickb";

const DIRECT_PLUS_ORDER = "direct-plus-order";

describe("IckbSdk.buildConversionTransaction", () => {
  it("plans CKB-to-iCKB direct deposits before fallback orders", async () => {
    const { sdk, logicManager, lock } = testSdk();
    const remainder = ccc.fixedPointFrom(10000);
    const deposit = vi
      .spyOn(logicManager, "deposit")
      .mockImplementation((txLike, quantity, depositCapacity, depositLock) => {
        expect(quantity).toBe(2);
        expect(depositCapacity).toBe(ICKB_DEPOSIT_CAP);
        expect(depositLock).toEqual(lock);
        const tx = ccc.Transaction.from(txLike);
        tx.outputs.push(ccc.CellOutput.from({ capacity: 1n, lock }));
        tx.outputsData.push("0x");
        return tx;
      });

    const result = await sdk.buildConversionTransaction({
      direction: CKB_TO_ICKB,
      amount: ICKB_DEPOSIT_CAP * 2n + remainder,
      signer: stubSigner,
      context: conversionContext({
        ckbAvailable: ICKB_DEPOSIT_CAP * 2n + remainder,
        ickbAvailable: 0n,
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      conversionKind: DIRECT_PLUS_ORDER,
    });
    expect(deposit).toHaveBeenCalledTimes(1);
    if (!result.ok) {
      throw new Error("Expected a conversion");
    }
    // The deposit's output first, then the remainder order and its master.
    expect(result.tx.outputs.map(({ lock: outputLock }) => outputLock)).toEqual([
      lock,
      ORDER,
      lock,
    ]);
    expect(mintedOrders(result.tx)).toMatchObject([
      { ckbValue: remainder, udtValue: 0n },
    ]);
  });

  it("reports no order cell space for whole deposits alone", async () => {
    const { sdk, logicManager } = testSdk();
    vi.spyOn(logicManager, "deposit").mockImplementation((txLike) =>
      ccc.Transaction.from(txLike),
    );

    const result = await sdk.buildConversionTransaction({
      direction: CKB_TO_ICKB,
      amount: ICKB_DEPOSIT_CAP * 2n,
      signer: stubSigner,
      context: conversionContext({ ckbAvailable: ICKB_DEPOSIT_CAP * 2n }),
    });

    expect(result).toMatchObject({ ok: true, conversionKind: "direct" });
    expect(result).not.toHaveProperty("orderOccupiedCapacity");
  });

  it.each([
    [conversionContext().system.depositCapacity, "direct"],
    [ccc.fixedPointFrom(10000), "order"],
  ])("names a CKB-to-iCKB conversion of %d shannons %s", async (amount, kind) => {
    const { sdk, logicManager } = testSdk();
    vi.spyOn(logicManager, "deposit").mockImplementation((txLike) =>
      ccc.Transaction.from(txLike),
    );

    await expect(
      sdk.buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount,
        signer: stubSigner,
        context: conversionContext({ ckbAvailable: amount }),
      }),
    ).resolves.toMatchObject({ ok: true, conversionKind: kind });
  });
});
